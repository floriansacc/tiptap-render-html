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

    case "text": {
      let text = escapeHtml(node.text ?? "");
      if (node.marks) {
        const marks = node.marks;
        const colorMark = marks.find(
          (m: any) => m.type === "textStyle" && m.attrs?.color,
        );
        const linkMark = marks.find((m: any) => m.type === "link");

        for (const mark of marks) {
          if (mark.type === "bold") text = `<strong>${text}</strong>`;
          if (mark.type === "italic") text = `<em>${text}</em>`;
          if (mark.type === "underline") text = `<u>${text}</u>`;
          if (mark.type === "strike") text = `<s>${text}</s>`;
          if (mark.type === "code") text = `<code>${text}</code>`;
          // textStyle below with link
        }

        // combine color + link into one element
        if (linkMark) {
          const href = escapeHtml(linkMark.attrs.href ?? "#");
          const target = linkMark.attrs.target ?? "_blank";
          const colorStyle = colorMark
            ? ` style="color: ${escapeHtml(colorMark.attrs.color)}"`
            : "";
          text = `<a href="${href}" target="${target}" rel="noopener noreferrer"${colorStyle}>${text}</a>`;
        } else if (colorMark) {
          text = `<span style="color: ${escapeHtml(colorMark.attrs.color)}">${text}</span>`;
        }
      }
      return text;
    }

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
