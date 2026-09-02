import JSZip from "jszip";

export type BookPage = {
  /** Plain text of the page/section chunk. */
  text: string;
  /** Chapter/section title if known. */
  chapter: string;
};

export type ParsedBook = {
  title: string;
  author: string;
  pages: BookPage[];
};

function textOf(node: Element | null | undefined): string {
  return node?.textContent?.trim() ?? "";
}

function resolvePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.slice(1);
  const baseParts = base.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function htmlToText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  const title =
    textOf(doc.querySelector("h1")) ||
    textOf(doc.querySelector("h2")) ||
    textOf(doc.querySelector("title"));
  const blocks: string[] = [];
  doc.body?.querySelectorAll("p, h1, h2, h3, li, blockquote").forEach((el) => {
    const t = el.textContent?.replace(/\s+/g, " ").trim();
    if (t) blocks.push(t);
  });
  const text = blocks.length
    ? blocks.join("\n\n")
    : (doc.body?.textContent?.replace(/\s+/g, " ").trim() ?? "");
  return { title, text };
}

/** Split long chapter text into readable "pages" of roughly `size` characters. */
function paginate(text: string, size = 1100): string[] {
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const pages: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length > size) {
      pages.push(current.trim());
      current = "";
    }
    current += (current ? "\n\n" : "") + p;
  }
  if (current.trim()) pages.push(current.trim());
  return pages;
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(file);

  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("Not a valid EPUB file (missing container).");
  const container = new DOMParser().parseFromString(
    await containerFile.async("string"),
    "application/xml",
  );
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Could not locate the EPUB package file.");

  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error("Could not read the EPUB package file.");
  const opf = new DOMParser().parseFromString(
    await opfEntry.async("string"),
    "application/xml",
  );

  const title = textOf(opf.querySelector("metadata title")) || file.name.replace(/\.epub$/i, "");
  const author = textOf(opf.querySelector("metadata creator")) || "Unknown author";

  const manifest = new Map<string, string>();
  opf.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  });

  const spine = Array.from(opf.querySelectorAll("spine > itemref"))
    .map((ref) => ref.getAttribute("idref"))
    .filter((id): id is string => Boolean(id));

  const pages: BookPage[] = [];
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const entry = zip.file(resolvePath(opfPath, href.split("#")[0] ?? href));
    if (!entry) continue;
    const { title: chapterTitle, text } = htmlToText(await entry.async("string"));
    if (text.length < 40) continue;
    const chunks = paginate(text);
    chunks.forEach((chunk, i) => {
      pages.push({
        text: chunk,
        chapter: chapterTitle || (i === 0 ? title : `${title} (cont.)`),
      });
    });
  }

  if (!pages.length) throw new Error("No readable text found in this EPUB.");
  return { title, author, pages };
}
