import io
import logging

import pdfplumber

from src.parsers.base import BaseParser

logger = logging.getLogger(__name__)


class PDFParser(BaseParser):
    """
    Extracts text from PDF files using pdfplumber.

    Primary path:  pdfplumber (handles machine-generated PDFs well).
    Fallback path: Tesseract OCR via pytesseract + pdf2image for scanned/image PDFs.
                   Only triggered when pdfplumber returns < 50 chars of text.
    """

    _OCR_TEXT_THRESHOLD = 50  # chars below which we assume the PDF is image-based

    def parse(self, data: bytes, filename: str = "") -> str:
        text = self._extract_with_pdfplumber(data, filename)
        if len(text.strip()) < self._OCR_TEXT_THRESHOLD:
            logger.warning(
                "PDFParser: pdfplumber returned minimal text for '%s' (%d chars). "
                "Attempting OCR fallback.",
                filename,
                len(text.strip()),
            )
            text = self._extract_with_ocr(data, filename)
        return text

    def _extract_with_pdfplumber(self, data: bytes, filename: str) -> str:
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                parts = []
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        parts.append(page_text)
                return "\n".join(parts)
        except Exception as exc:
            logger.error("PDFParser: pdfplumber failed for '%s': %s", filename, exc)
            return ""

    def _extract_with_ocr(self, data: bytes, filename: str) -> str:
        try:
            import pytesseract
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(data, dpi=300)
            parts = [pytesseract.image_to_string(img) for img in images]
            result = "\n".join(parts)
            logger.info(
                "PDFParser: OCR extracted %d chars from '%s'.", len(result), filename
            )
            return result
        except ImportError:
            logger.warning(
                "PDFParser: OCR fallback unavailable (pytesseract/pdf2image not installed). "
                "Install them to handle scanned PDFs."
            )
            return ""
        except Exception as exc:
            logger.error("PDFParser: OCR failed for '%s': %s", filename, exc)
            return ""
