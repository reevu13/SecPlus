#!/usr/bin/env python3
"""Extract a structure-only outline from an EPUB source book.

This script intentionally avoids exporting chapter text. It emits only:
- chapter/section titles
- ordering
- href links
- word counts
- stable hashes
"""

from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
import sys
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET


WORD_RE = re.compile(r"[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?")
WS_RE = re.compile(r"\s+")
CHAPTER_RE = re.compile(r"\bchapter\s*0*(\d{1,3})\b", re.IGNORECASE)
CH_RE = re.compile(r"\bch(?:apter)?[_\-\s]*0*(\d{1,3})\b", re.IGNORECASE)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_space(value: str) -> str:
    return WS_RE.sub(" ", value).strip()


def count_words(value: str) -> int:
    return len(WORD_RE.findall(value))


def stable_hash(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x1f")
    return digest.hexdigest()


def file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 64)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def slug_to_title(value: str) -> str:
    stem = Path(value).stem
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    return stem.title() if stem else value


def infer_chapter_number(title: str, href: str, fallback_order: int) -> int:
    for candidate in (title, href):
        match = CHAPTER_RE.search(candidate)
        if match:
            return int(match.group(1))
        match = CH_RE.search(candidate)
        if match:
            return int(match.group(1))
    return fallback_order


class OutlineParser(HTMLParser):
    """Captures heading structure and word counts without storing full text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: List[Dict[str, object]] = []
        self.total_word_count = 0
        self._in_title = False
        self._skip_depth = 0
        self._title_parts: List[str] = []
        self._heading_level: Optional[int] = None
        self._heading_parts: List[str] = []
        self._active_section_index: Optional[int] = None
        self._content_digest = hashlib.sha256()

    @property
    def document_title(self) -> str:
        return normalize_space(" ".join(self._title_parts))

    @property
    def content_hash(self) -> str:
        return self._content_digest.hexdigest()

    def _record_word_chunk(self, chunk: str) -> None:
        words = count_words(chunk)
        if words == 0:
            return
        self.total_word_count += words
        self._content_digest.update(chunk.encode("utf-8"))
        self._content_digest.update(b"\n")
        if self._heading_level is None and self._active_section_index is not None:
            self.sections[self._active_section_index]["word_count"] = (
                int(self.sections[self._active_section_index]["word_count"]) + words
            )

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        lower = tag.lower()
        if lower in {"script", "style"}:
            self._skip_depth += 1
            return
        if lower == "title":
            self._in_title = True
            return
        if lower.startswith("h") and len(lower) == 2 and lower[1].isdigit():
            self._heading_level = int(lower[1])
            self._heading_parts = []

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in {"script", "style"}:
            if self._skip_depth > 0:
                self._skip_depth -= 1
            return
        if lower == "title":
            self._in_title = False
            return
        if (
            self._heading_level is not None
            and lower.startswith("h")
            and len(lower) == 2
            and lower[1].isdigit()
            and int(lower[1]) == self._heading_level
        ):
            heading_title = normalize_space(" ".join(self._heading_parts))
            if heading_title:
                self.sections.append(
                    {
                        "order": len(self.sections) + 1,
                        "level": self._heading_level,
                        "title": heading_title,
                        "word_count": 0,
                    }
                )
                self._active_section_index = len(self.sections) - 1
            self._heading_level = None
            self._heading_parts = []

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        chunk = normalize_space(data)
        if not chunk:
            return
        self._record_word_chunk(chunk)
        if self._in_title:
            self._title_parts.append(chunk)
        if self._heading_level is not None:
            self._heading_parts.append(chunk)


def parse_document(order: int, href: str, content_bytes: bytes) -> Dict[str, object]:
    parser = OutlineParser()
    try:
        parser.feed(content_bytes.decode("utf-8", errors="ignore"))
        parser.close()
    except Exception:
        # Keep extraction resilient for malformed XHTML chunks.
        pass

    headings = parser.sections
    first_heading = headings[0]["title"] if headings else ""
    chapter_title = first_heading or parser.document_title or slug_to_title(href)

    # If the first heading mirrors the chapter title, treat deeper headings as sections.
    section_rows = headings
    if headings:
        first_level = int(headings[0]["level"])
        if normalize_space(str(first_heading)).casefold() == normalize_space(chapter_title).casefold() and first_level <= 2:
            section_rows = headings[1:]

    sections: List[Dict[str, object]] = []
    for section_index, section in enumerate(section_rows, start=1):
        level = int(section["level"])
        title = str(section["title"])
        word_count = int(section["word_count"])
        sections.append(
            {
                "order": section_index,
                "level": level,
                "title": title,
                "href": f"{href}#s{section_index}",
                "word_count": word_count,
                "hash": stable_hash(href, str(level), title, str(word_count)),
            }
        )

    return {
        "order": order,
        "chapter_number": infer_chapter_number(chapter_title, href, order),
        "href": href,
        "title": chapter_title,
        "word_count": parser.total_word_count,
        "hash": stable_hash(href, chapter_title, str(parser.total_word_count), parser.content_hash),
        "sections": sections,
    }


def load_spine_with_ebooklib(epub_path: Path) -> Iterable[Tuple[int, str, bytes]]:
    from ebooklib import ITEM_DOCUMENT  # type: ignore
    from ebooklib import epub  # type: ignore

    book = epub.read_epub(str(epub_path))
    for order, entry in enumerate(book.spine, start=1):
        item_id = entry[0] if isinstance(entry, (tuple, list)) else entry
        item = book.get_item_with_id(item_id)
        if item is None or item.get_type() != ITEM_DOCUMENT:
            continue
        yield order, item.get_name(), item.get_content()


def load_spine_from_zip(epub_path: Path) -> Iterable[Tuple[int, str, bytes]]:
    with zipfile.ZipFile(epub_path, "r") as archive:
        container_raw = archive.read("META-INF/container.xml")
        container_xml = ET.fromstring(container_raw)
        rootfile = container_xml.find(".//{*}rootfile")
        if rootfile is None:
            raise RuntimeError("Unable to locate rootfile in META-INF/container.xml")
        opf_path = rootfile.attrib.get("full-path")
        if not opf_path:
            raise RuntimeError("Missing rootfile full-path attribute")

        opf_raw = archive.read(opf_path)
        opf_xml = ET.fromstring(opf_raw)
        opf_dir = posixpath.dirname(opf_path)

        manifest: Dict[str, str] = {}
        manifest_media: Dict[str, str] = {}
        for item in opf_xml.findall(".//{*}manifest/{*}item"):
            item_id = item.attrib.get("id")
            href = item.attrib.get("href")
            media_type = item.attrib.get("media-type", "")
            if item_id and href:
                manifest[item_id] = href
                manifest_media[item_id] = media_type

        order = 0
        for itemref in opf_xml.findall(".//{*}spine/{*}itemref"):
            item_id = itemref.attrib.get("idref")
            if not item_id or item_id not in manifest:
                continue
            media_type = manifest_media.get(item_id, "")
            if "xhtml" not in media_type and "html" not in media_type:
                continue
            href = manifest[item_id]
            archive_path = posixpath.normpath(posixpath.join(opf_dir, href))
            try:
                content = archive.read(archive_path)
            except KeyError:
                continue
            order += 1
            yield order, href, content


def write_markdown(outline: Dict[str, object], md_path: Path) -> None:
    chapters: List[Dict[str, object]] = list(outline["chapters"])  # type: ignore[arg-type]
    section_total = sum(len(chapter["sections"]) for chapter in chapters)

    lines = [
        "# EPUB Structure Outline",
        "",
        f"- Generated: {outline['generated_at']}",
        f"- Source: `{outline['source_epub']}`",
        f"- Source SHA-256: `{outline['source_sha256']}`",
        f"- Engine: `{outline['engine']}`",
        f"- Chapters: {len(chapters)}",
        f"- Sections: {section_total}",
        "",
    ]

    for chapter in chapters:
        lines.extend(
            [
                f"## {chapter['order']}. {chapter['title']}",
                f"- Chapter number: {chapter['chapter_number']}",
                f"- Href: `{chapter['href']}`",
                f"- Words: {chapter['word_count']}",
                f"- Hash: `{chapter['hash']}`",
            ]
        )
        sections = chapter["sections"]
        if not sections:
            lines.append("- Sections: _none detected_")
            lines.append("")
            continue
        lines.append("- Sections:")
        for section in sections:
            lines.append(
                f"  - {section['order']}. [{section['level']}] {section['title']} "
                f"(words: {section['word_count']}, hash: `{section['hash']}`)"
            )
        lines.append("")

    md_path.write_text("\n".join(lines), encoding="utf-8")


def build_outline(epub_path: Path) -> Dict[str, object]:
    engine = "ebooklib"
    try:
        spine_rows = list(load_spine_with_ebooklib(epub_path))
    except ModuleNotFoundError:
        print("EbookLib not installed; using zip parser fallback.", file=sys.stderr)
        engine = "zip_fallback"
        spine_rows = list(load_spine_from_zip(epub_path))

    if not spine_rows:
        raise RuntimeError("No spine XHTML documents found in EPUB.")

    chapters: List[Dict[str, object]] = []
    seen_hrefs = set()
    for order, href, content in spine_rows:
        if href in seen_hrefs:
            continue
        seen_hrefs.add(href)
        chapter = parse_document(order=len(chapters) + 1, href=href, content_bytes=content)
        if chapter["word_count"] == 0 and not chapter["sections"]:
            continue
        chapters.append(chapter)

    if not chapters:
        raise RuntimeError("Spine parsing finished, but no chapter structure was extracted.")

    return {
        "generated_at": now_iso(),
        "source_epub": str(epub_path),
        "source_sha256": file_sha256(epub_path),
        "source_size_bytes": epub_path.stat().st_size,
        "engine": engine,
        "chapters": chapters,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract a structure-only outline from an EPUB.")
    parser.add_argument("--input", default="content/source/sybex.epub", help="Input EPUB path")
    parser.add_argument(
        "--json-output",
        default="content/_source_outline/book_outline.json",
        help="Output JSON path",
    )
    parser.add_argument(
        "--md-output",
        default="content/_source_outline/book_outline.md",
        help="Output Markdown path",
    )
    args = parser.parse_args()

    epub_path = Path(args.input)
    json_output = Path(args.json_output)
    md_output = Path(args.md_output)

    if not epub_path.exists():
        print(f"Input EPUB not found: {epub_path}", file=sys.stderr)
        return 1

    try:
        outline = build_outline(epub_path)
    except Exception as exc:  # pragma: no cover - defensive command-line path
        print(f"Failed to build outline: {exc}", file=sys.stderr)
        return 1

    json_output.parent.mkdir(parents=True, exist_ok=True)
    md_output.parent.mkdir(parents=True, exist_ok=True)

    json_output.write_text(json.dumps(outline, indent=2, ensure_ascii=False), encoding="utf-8")
    write_markdown(outline, md_output)

    chapter_count = len(outline["chapters"])  # type: ignore[index]
    section_count = sum(len(chapter["sections"]) for chapter in outline["chapters"])  # type: ignore[index]
    print(
        f"Outline extracted: {chapter_count} chapters, {section_count} sections "
        f"-> {json_output} and {md_output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
