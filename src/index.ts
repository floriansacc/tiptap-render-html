function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getAlignStyle(node: any): string {
  const align = node.attrs?.textAlign;
  return align && align !== "left" ? ` style="text-align: ${align}"` : "";
}

// keeps a css value inside its declaration (no `;` to add other properties, no quote to leave the attribute)
function sanitizeCssValue(value: string): string {
  return value.replace(/[;"'<>{}\\]/g, "").trim();
}

/**
 * Renders a text node with its marks, nested in a fixed order (outer → inner):
 * link > textStyle span > bold > italic > underline > strike > code.
 *
 * The page shows the html inside `prose` (tailwind typography), which gives `strong`, `code` and `a`
 * their own color: an inherited color from an outer span is overridden there. So the textStyle color
 * is repeated on those elements, and em/u/s (decoration color included) inherit it from them.
 */
function renderText(node: any): string {
  const raw: string = node.text ?? "";
  // an empty text would still produce empty tags, and keep its paragraph from getting a <br>
  if (!raw) return "";

  const marks: any[] = node.marks ?? [];
  const hasMark = (type: string) => marks.some((m) => m.type === type);

  const textStyle = marks.find((m) => m.type === "textStyle")?.attrs ?? {};
  const color = textStyle.color
    ? sanitizeCssValue(String(textStyle.color))
    : "";
  const colorStyle = color ? ` style="color: ${escapeHtml(color)}"` : "";

  let html = escapeHtml(raw);
  if (hasMark("code")) html = `<code${colorStyle}>${html}</code>`;
  if (hasMark("strike")) html = `<s>${html}</s>`;
  if (hasMark("underline")) html = `<u>${html}</u>`;
  if (hasMark("italic")) html = `<em>${html}</em>`;
  if (hasMark("bold")) html = `<strong${colorStyle}>${html}</strong>`;

  const linkMark = marks.find((m) => m.type === "link");
  if (linkMark) {
    const href = escapeHtml(linkMark.attrs?.href ?? "#");
    const target = escapeHtml(linkMark.attrs?.target ?? "_blank");
    html = `<a href="${href}" target="${target}" rel="noopener noreferrer"${colorStyle}>${html}</a>`;
  } else if (color) {
    html = `<span${colorStyle}>${html}</span>`;
  }

  return html;
}

function renderNode(node: any): string {
  switch (node.type) {
    case "doc":
      return renderChildren(node);

    case "paragraph": {
      const inner = renderChildren(node);
      return `<p${getAlignStyle(node)}>${inner || "<br>"}</p>`;
    }

    case "heading": {
      const inner = renderChildren(node);
      return `<h${node.attrs.level}${getAlignStyle(node)}>${inner || "<br>"}</h${node.attrs.level}>`;
    }

    case "text":
      return renderText(node);

    case "youtube": {
      const { src, width, height, start } = node.attrs;

      // convert watch URL to embed URL
      const embedUrl =
        src
          .replace("watch?v=", "embed/")
          .replace("youtu.be/", "www.youtube.com/embed/") +
        (start ? `?start=${start}` : "");

      return `
        <div style="display: flex; justify-content: center; margin: 1rem 0;">
          <iframe
            src="${escapeHtml(embedUrl)}"
            width="${width ?? 640}"
            height="${height ?? 480}"
            frameborder="0"
            allowfullscreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          ></iframe>
        </div>`;
    }

    // plain tiptap image, created when pasting content with <img> (ex: external page, badges)
    case "image": {
      if (!node.attrs?.src) return "";

      const { src, alt, title, width, height } = node.attrs;
      const sizeAttrs = `${width ? ` width="${escapeHtml(String(width))}"` : ""}${height ? ` height="${escapeHtml(String(height))}"` : ""}`;

      return `
        <div${getAlignStyle(node)}>
          <img src="${escapeHtml(src)}" alt="${escapeHtml(alt ?? "")}"${title ? ` title="${escapeHtml(title)}"` : ""}${sizeAttrs} style="display: inline-block; max-width: 100%; height: auto;" />
        </div>`;
    }

    case "imageResize":
      return `
        <div style="${node.attrs.wrapperStyle ?? ""}">
          <div style="${node.attrs.containerStyle ?? ""}">
            <img src="${escapeHtml(node.attrs.src)}" alt="${escapeHtml(node.attrs.alt ?? "")}" width="${node.attrs.width ?? ""}" />
          </div>
        </div>`;

    case "bulletList":
      return `<ul>${renderChildren(node)}</ul>`;

    case "orderedList":
      return `<ol>${renderChildren(node)}</ol>`;

    case "listItem":
      return `<li>${renderChildren(node)}</li>`;

    case "blockquote":
      return `<blockquote>${renderChildren(node)}</blockquote>`;

    case "codeBlock":
      return `<pre><code>${renderChildren(node)}</code></pre>`; // text node already escapes

    case "hardBreak":
      return `<br>`;

    case "horizontalRule":
      return `<hr>`;

    default:
      return renderChildren(node);
  }
}

function renderChildren(node: any): string {
  return (node.content ?? []).map(renderNode).join("");
}

export function renderBlogContent(json: string): string {
  return renderNode(JSON.parse(json));
}

export function extractImageUrls(node: any): string[] {
  const urls: string[] = [];
  if ((node.type === "image" || node.type === "imageResize") && node.attrs?.src)
    urls.push(node.attrs.src);
  if (node.content) {
    for (const child of node.content) urls.push(...extractImageUrls(child));
  }
  return urls;
}

// nodes that are empty when they have no children: containers, line break, and the pending upload placeholder
const NON_CONTENT_NODE_TYPES = [
  "doc",
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "codeBlock",
  "hardBreak",
  "imageUpload",
];

/**
 * True if the editor JSON has visible content (non blank text, image, youtube, horizontal rule...).
 * `attrs` can't be used as a signal: TextAlign adds `{ textAlign: null }` to every paragraph, even empty ones.
 */
export function hasVisibleContent(node: any): boolean {
  if (!node) return false;
  if (node.type === "text") return (node.text ?? "").trim().length > 0;
  if (node.content?.length) return node.content.some(hasVisibleContent);

  return !NON_CONTENT_NODE_TYPES.includes(node.type);
}
