# tiptap-render-html

Render Tiptap JSON content to HTML.

## Install

```sh
npm install floriansacc/tiptap-render-html
```

## Usage

```ts
import { renderBlogContent } from "tiptap-render-html";

const html = renderBlogContent(
  JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello Tiptap" }],
      },
    ],
  }),
);
```

## API

### `renderBlogContent(json)`

Parses a Tiptap JSON string and renders it to HTML.

### `renderNode(node)`

Renders a parsed Tiptap node object to HTML.

### `renderChildren(node)`

Renders a node's child content to HTML.
