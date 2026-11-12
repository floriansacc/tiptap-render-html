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

### `extractImageUrls(node)`

Returns the `src` of every `image` and `imageResize` node in a parsed Tiptap node tree.

### `hasVisibleContent(node)`

Returns `true` if a parsed Tiptap node tree has visible content (non-blank text, image, YouTube embed, horizontal rule...). Empty paragraphs, headings, lists, hard breaks and pending `imageUpload` placeholders don't count.
