// isomorphic: plain dompurify needs a DOM, and the html is also rendered on the server (Nuxt SSR)
import DOMPurify from "isomorphic-dompurify";

/*
 * Renders the tiptap JSON of a blog / notice / faq to HTML, shown with `v-html`.
 *
 * The JSON comes from the database: it can hold anything, not only what the editor produces.
 * So nothing from `attrs` is trusted:
 * - every value is escaped, and checked against what the editor can produce (allowlists, numbers, url protocols)
 * - the final HTML goes through DOMPurify as a second layer, in case the renderer misses something
 */

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- value checks ---------------------------------------------------------

const TEXT_ALIGNS = ["left", "center", "right", "justify"];

function getAlignStyle(node: any): string {
  const align = node.attrs?.textAlign;
  return TEXT_ALIGNS.includes(align) && align !== "left"
    ? ` style="text-align: ${align}"`
    : "";
}

/** A positive number, or null (also for "", null, "100px", "1\" onload=..."...) */
function toPositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// hex, rgb(a), hsl(a) or a named color. No other css function (url(), var()...) and no `;` to add a property
const CSS_COLOR =
  /^(#[0-9a-f]{3,8}|rgba?\([\d.%\s,/]+\)|hsla?\([\d.%\s,/deg]+\)|[a-z]+)$/i;

function sanitizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return CSS_COLOR.test(color) ? color : null;
}

const LINK_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];
const IMAGE_PROTOCOLS = ["http:", "https:"];

/**
 * The url if its protocol is allowed (or if it's relative), null otherwise (`javascript:`, `vbscript:`, `data:`...).
 * Browsers ignore whitespace and control characters inside a protocol (`java\tscript:` runs), so the
 * protocol is read without them.
 */
function sanitizeUrl(
  value: unknown,
  protocols: string[],
  { allowDataImage = false } = {},
): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  const compact = url.replace(/[\u0000- \u007f]/g, "");
  if (!compact) return null;

  // pasted images can be inlined as base64, a data image can't run script inside an <img>
  if (allowDataImage && /^data:image\//i.test(compact)) return url;

  const protocol = compact.match(/^([a-z][a-z\d+.-]*):/i)?.[1];
  if (protocol === undefined) return url; // relative url: /path, #anchor, ?query, //host
  return protocols.includes(`${protocol.toLowerCase()}:`) ? url : null;
}

const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
];

/** The video id of a youtube url (watch, youtu.be, embed, shorts, live), null if it's not one */
function getYoutubeVideoId(src: unknown): string | null {
  if (typeof src !== "string") return null;

  let url: URL;
  try {
    url = new URL(src.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.includes(host)) return null;

  let id: string | null;
  if (host === "youtu.be") id = url.pathname.slice(1);
  else if (url.pathname === "/watch") id = url.searchParams.get("v");
  else
    id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;

  return id && /^[\w-]{1,64}$/.test(id) ? id : null;
}

// exactly what the youtube case renders, checked again by DOMPurify on every iframe
const YOUTUBE_EMBED_URL =
  /^https:\/\/www\.youtube\.com\/embed\/[\w-]{1,64}(\?start=\d+)?$/;

const CSS_DIMENSION = /^(-?\d+(\.\d+)?(px|em|rem|%|vw|vh)|0|auto)$/i;
const isDimensions = (value: string) =>
  value.split(/\s+/).every((token) => CSS_DIMENSION.test(token));
const isOneOf =
  (...allowed: string[]) =>
  (value: string) =>
    allowed.includes(value.toLowerCase());

// the properties tiptap-extension-resize-image writes in `wrapperStyle` / `containerStyle`
// (its editor only properties, like `cursor`, are dropped)
const IMAGE_STYLE_PROPERTIES: Record<string, (value: string) => boolean> = {
  width: isDimensions,
  height: isDimensions,
  "max-width": isDimensions,
  display: isOneOf("block", "inline-block", "inline", "flex"),
  float: isOneOf("left", "right", "none"),
  margin: isDimensions,
  "margin-top": isDimensions,
  "margin-right": isDimensions,
  "margin-bottom": isDimensions,
  "margin-left": isDimensions,
  padding: isDimensions,
  "padding-top": isDimensions,
  "padding-right": isDimensions,
  "padding-bottom": isDimensions,
  "padding-left": isDimensions,
};

/** Rebuilds a style string with only the allowed properties, and values matching their check */
function sanitizeImageStyle(value: unknown): string {
  if (typeof value !== "string") return "";

  const declarations: string[] = [];
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;

    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();
    const isValid = IMAGE_STYLE_PROPERTIES[property];
    if (isValid && propertyValue && isValid(propertyValue))
      declarations.push(`${property}: ${propertyValue};`);
  }
  return declarations.join(" ");
}

// --- rendering ------------------------------------------------------------

/**
 * Renders a text node with its marks, nested in a fixed order (outer → inner):
 * link > textStyle span > bold > italic > underline > strike > code.
 *
 * The page shows the html inside `prose` (tailwind typography), which gives `strong`, `code` and `a`
 * their own color: an inherited color from an outer span is overridden there. So the textStyle color
 * is repeated on those elements, and em/u/s (decoration color included) inherit it from them.
 */
function renderText(node: any): string {
  const raw = typeof node.text === "string" ? node.text : "";
  // an empty text would still produce empty tags, and keep its paragraph from getting a <br>
  if (!raw) return "";

  const marks: any[] = Array.isArray(node.marks) ? node.marks : [];
  const hasMark = (type: string) => marks.some((m) => m?.type === type);

  const textStyle = marks.find((m) => m?.type === "textStyle")?.attrs ?? {};
  const color = sanitizeColor(textStyle.color);
  const colorStyle = color ? ` style="color: ${escapeHtml(color)}"` : "";

  let html = escapeHtml(raw);
  if (hasMark("code")) html = `<code${colorStyle}>${html}</code>`;
  if (hasMark("strike")) html = `<s>${html}</s>`;
  if (hasMark("underline")) html = `<u>${html}</u>`;
  if (hasMark("italic")) html = `<em>${html}</em>`;
  if (hasMark("bold")) html = `<strong${colorStyle}>${html}</strong>`;

  const linkMark = marks.find((m) => m?.type === "link");
  // a link with a blocked url (javascript:...) is rendered as plain text
  const href = linkMark
    ? sanitizeUrl(linkMark.attrs?.href, LINK_PROTOCOLS)
    : null;
  if (href) {
    const target = linkMark.attrs?.target === "_self" ? "_self" : "_blank";
    html = `<a href="${escapeHtml(href)}" target="${target}" rel="noopener noreferrer"${colorStyle}>${html}</a>`;
  } else if (color) {
    html = `<span${colorStyle}>${html}</span>`;
  }

  return html;
}

function renderNode(node: any): string {
  if (!node || typeof node !== "object") return "";

  switch (node.type) {
    case "doc":
      return renderChildren(node);

    case "paragraph": {
      const inner = renderChildren(node);
      return `<p${getAlignStyle(node)}>${inner || "<br>"}</p>`;
    }

    case "heading": {
      const inner = renderChildren(node);
      const level = Number(node.attrs?.level);
      // the level goes in the tag name: anything else than 1-6 falls back to a paragraph
      const tag =
        Number.isInteger(level) && level >= 1 && level <= 6 ? `h${level}` : "p";
      return `<${tag}${getAlignStyle(node)}>${inner || "<br>"}</${tag}>`;
    }

    case "text":
      return renderText(node);

    case "youtube": {
      // the embed url is rebuilt from the video id, never taken from `src`
      const videoId = getYoutubeVideoId(node.attrs?.src);
      if (!videoId) return "";

      const start = toPositiveNumber(node.attrs?.start);
      const embedUrl = `https://www.youtube.com/embed/${videoId}${start ? `?start=${Math.floor(start)}` : ""}`;
      const width = toPositiveNumber(node.attrs?.width) ?? 640;
      const height = toPositiveNumber(node.attrs?.height) ?? 480;

      return `
        <div style="display: flex; justify-content: center; margin: 1rem 0;">
          <iframe
            src="${embedUrl}"
            width="${width}"
            height="${height}"
            frameborder="0"
            allowfullscreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          ></iframe>
        </div>`;
    }

    // plain tiptap image, created when pasting content with <img> (ex: external page, badges)
    case "image": {
      const src = sanitizeUrl(node.attrs?.src, IMAGE_PROTOCOLS, {
        allowDataImage: true,
      });
      if (!src) return "";

      const { alt, title } = node.attrs;
      const width = toPositiveNumber(node.attrs.width);
      const height = toPositiveNumber(node.attrs.height);
      const sizeAttrs = `${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}`;
      const titleAttr =
        typeof title === "string" && title
          ? ` title="${escapeHtml(title)}"`
          : "";

      return `
        <div${getAlignStyle(node)}>
          <img src="${escapeHtml(src)}" alt="${escapeHtml(String(alt ?? ""))}"${titleAttr}${sizeAttrs} style="display: inline-block; max-width: 100%; height: auto;" />
        </div>`;
    }

    case "imageResize": {
      const src = sanitizeUrl(node.attrs?.src, IMAGE_PROTOCOLS, {
        allowDataImage: true,
      });
      if (!src) return "";

      const width = toPositiveNumber(node.attrs.width);
      return `
        <div style="${escapeHtml(sanitizeImageStyle(node.attrs.wrapperStyle))}">
          <div style="${escapeHtml(sanitizeImageStyle(node.attrs.containerStyle))}">
            <img src="${escapeHtml(src)}" alt="${escapeHtml(String(node.attrs.alt ?? ""))}"${width ? ` width="${width}"` : ""} />
          </div>
        </div>`;
    }

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
  return Array.isArray(node.content)
    ? node.content.map(renderNode).join("")
    : "";
}

// --- sanitizing -----------------------------------------------------------

/**
 * Second layer: removes anything executable (event handlers, scripts, javascript: urls...) the renderer let through.
 *
 * Iframes are allowed for youtube only: any other src is dropped. The hook is added for this call only:
 * - in the browser, the DOMPurify instance is shared with the app, which shouldn't get our iframe rule
 * - on the server, `clearWindow()` replaces the instance, which would silently lose a hook added once at import
 * `sanitize` is synchronous, so no other call can run between add and remove.
 */
function sanitizeHtml(html: string): string {
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (
      node.nodeName === "IFRAME" &&
      data.attrName === "src" &&
      !YOUTUBE_EMBED_URL.test(data.attrValue)
    ) {
      data.keepAttr = false;
    }
  });

  try {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ["iframe"],
      ADD_ATTR: ["target", "allow", "allowfullscreen", "frameborder"],
    });
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}

export function renderBlogContent(json: string): string {
  return sanitizeHtml(renderNode(JSON.parse(json)));
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
