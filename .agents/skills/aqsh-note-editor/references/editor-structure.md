# Editor structure observation

`inspect / verify`の観測は、可視テキストだけでなく本文DOMを許可リストへ正規化した`structure`を必須とする。これにより、同じ表示文字列のリンク先変更、リスト階層、引用、強調、見出し種別の変更を競合として検知する。

## 安全境界

- 対象はplan記載の編集URLにある、可視の`div[role=textbox][contenteditable=true][aria-multiline=true]` 1件だけとする。
- DOMを読む前に、設定画面でnote ID `aqsh`を確認し、編集URLとtext-only UI契約を再検査する。
- `script`、`style`、イベント属性、未知タグは無視せず観測失敗にする。
- `id`、`name`、`class`、`contenteditable`などnote実装固有の属性は構造へ保存しない。
- 入力、貼付、クリック、focus変更、保存、再読込を行わない。
- Cookie、storage、network、HTML全文、外部タブを取得しない。
- 本文を含む観測JSONとsnapshotはGit外に権限`0600`でのみ保存する。

## Canonical structure v1

各nodeは次のexact schemaだけを許可する。

```json
{"type":"text","value":"表示文字列"}
{"type":"element","tag":"p","attrs":{},"children":[]}
```

許可タグは次のとおり。

```text
p h2 h3 h4 h5 h6 ul ol li blockquote
strong em s u mark a br hr pre code img figure figcaption
```

意味を保つ属性だけを保存する。

- `a`: `href`、任意の`title`
- `img`: `src`、`alt`、任意の`title`
- `ol`: `start`。省略時は文字列`"1"`
- `pre / code`: `language`。不明なら空文字列
- その他: 空object

`B`は`strong`、`I`は`em`、`DEL`と`STRIKE`は`s`へ正規化する。通常テキストは改行をLFへ揃えて連続空白を1個へ畳み、段落・見出し・`li`・引用・インライン装飾・リンク・`figcaption`の境界空白を除く。`pre / code`内は空白を保持する。隣接するtext nodeは結合し、空nodeは除く。

## Browser-side serializer

次の関数と同じ規則で、本文要素の`childNodes`を`structure`へ変換する。戻り値が作れない場合は観測JSONを作らず停止する。

```js
function canonicalEditorStructure(body) {
  const aliases = new Map([
    ["b", "strong"],
    ["i", "em"],
    ["del", "s"],
    ["strike", "s"]
  ]);
  const allowed = new Set([
    "p", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote",
    "strong", "em", "s", "u", "mark", "a",
    "br", "hr", "pre", "code", "img", "figure", "figcaption"
  ]);
  const voidTags = new Set(["br", "hr", "img"]);
  const trimTags = new Set([
    "p", "h2", "h3", "h4", "h5", "h6", "li", "blockquote",
    "strong", "em", "s", "u", "mark", "a", "figcaption"
  ]);
  const blockContainers = new Set([
    "root", "ul", "ol", "blockquote", "figure"
  ]);
  const maximum = { depth: 32, nodes: 50000, valueLength: 500000 };
  let count = 0;

  const cleanText = (value, preserve) => {
    if (typeof value !== "string" || value.length > maximum.valueLength || value.includes("\0")) {
      throw new Error("invalid editor text");
    }
    const lf = value.replace(/\r\n?/g, "\n");
    return preserve ? lf : lf.replace(/\s+/g, " ");
  };

  const cleanUrl = value => {
    const result = cleanText(value, false).trim();
    if (!result || /[\u0000-\u001f\u007f]/.test(result)) throw new Error("invalid editor URL");
    return result;
  };

  const attributes = (element, tag) => {
    if ([...element.attributes].some(attribute => attribute.name.toLowerCase().startsWith("on"))) {
      throw new Error("unsafe editor attribute");
    }
    if (tag === "a") {
      const result = { href: cleanUrl(element.getAttribute("href") ?? "") };
      if (element.hasAttribute("title")) result.title = cleanText(element.getAttribute("title") ?? "", false);
      return result;
    }
    if (tag === "img") {
      const result = {
        src: cleanUrl(element.getAttribute("src") ?? ""),
        alt: cleanText(element.getAttribute("alt") ?? "", false)
      };
      if (element.hasAttribute("title")) result.title = cleanText(element.getAttribute("title") ?? "", false);
      return result;
    }
    if (tag === "ol") {
      const start = element.getAttribute("start") ?? "1";
      if (!/^\d+$/.test(start) || Number(start) < 1) throw new Error("invalid ordered-list start");
      return { start };
    }
    if (tag === "pre" || tag === "code") {
      const className = element.getAttribute("class") ?? "";
      const match = className.match(/(?:^|\s)language-([^\s]+)/);
      return { language: match?.[1] ?? "" };
    }
    return {};
  };

  const children = (parent, parentTag, depth, preserve) => {
    const result = [];
    for (const child of parent.childNodes) {
      const item = walk(child, parentTag, depth + 1, preserve);
      if (!item) continue;
      if (item.type === "text" && blockContainers.has(parentTag) && item.value.trim() === "") continue;
      const previous = result.at(-1);
      if (item.type === "text" && previous?.type === "text") previous.value += item.value;
      else result.push(item);
    }
    if (trimTags.has(parentTag) && result[0]?.type === "text") result[0].value = result[0].value.trimStart();
    if (trimTags.has(parentTag) && result.at(-1)?.type === "text") result.at(-1).value = result.at(-1).value.trimEnd();
    return result.filter(item => item.type !== "text" || item.value !== "");
  };

  const walk = (node, parentTag, depth, preserve) => {
    count += 1;
    if (count > maximum.nodes || depth > maximum.depth) throw new Error("editor structure too large");
    if (node.nodeType === Node.TEXT_NODE) {
      const value = cleanText(node.nodeValue ?? "", preserve);
      return value === "" ? null : { type: "text", value };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) throw new Error("unsupported editor node");
    const element = node;
    const rawTag = element.tagName.toLowerCase();
    const tag = aliases.get(rawTag) ?? rawTag;
    if (!allowed.has(tag)) throw new Error(`unsupported editor tag: ${rawTag}`);
    const attrs = attributes(element, tag);
    if (voidTags.has(tag) && element.childNodes.length !== 0) throw new Error("invalid void element");
    return {
      type: "element",
      tag,
      attrs,
      children: voidTags.has(tag) ? [] : children(element, tag, depth, preserve || tag === "pre" || tag === "code")
    };
  };

  if (!(body instanceof HTMLElement)) throw new Error("editor body is missing");
  return children(body, "root", 0, false);
}
```

観測JSONは`accountId / url / title / text / structure / h2 / h3 / imageCount / saveControlName / publishControlName / mutated`のexact schemaとする。`mutated`は常に`false`でなければならない。

## 現在の制限

Markdown画像の`src`はローカル相対パス、note保存後の`src`はnote配信URLになるため、同一画像を結び付けるasset identityは未実装である。画像を含む記事のstructural verify、画像挿入、アイキャッチ、既存記事更新はhard stopのままとする。
