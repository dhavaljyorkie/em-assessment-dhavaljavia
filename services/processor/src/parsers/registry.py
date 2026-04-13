import logging
from pathlib import Path

from src.parsers.base import BaseParser
from src.parsers.docx_parser import DocxParser
from src.parsers.pdf_parser import PDFParser

logger = logging.getLogger(__name__)

# Registry mapping lowercase file extension → parser instance.
# To add a new format, add one entry here — no other file needs to change.
_REGISTRY: dict[str, BaseParser] = {
    ".pdf": PDFParser(),
    ".docx": DocxParser(),
}


def get_parser(filename: str) -> BaseParser:
    """
    Return the appropriate parser for the given filename.

    Raises:
        ValueError: if the file extension has no registered parser.
    """
    ext = Path(filename).suffix.lower()
    parser = _REGISTRY.get(ext)
    if parser is None:
        supported = ", ".join(_REGISTRY.keys())
        raise ValueError(
            f"No parser registered for extension '{ext}'. "
            f"Supported formats: {supported}"
        )
    logger.debug("get_parser: using %s for '%s'", type(parser).__name__, filename)
    return parser


def supported_extensions() -> list[str]:
    """Return the list of extensions that have a registered parser."""
    return list(_REGISTRY.keys())
