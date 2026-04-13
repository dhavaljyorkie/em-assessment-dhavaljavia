import abc


class BaseParser(abc.ABC):
    """
    Abstract base for all document parsers.
    Subclasses implement parse() for a specific file format.
    Keeping the interface to a single method makes adding new formats
    (e.g. TXT, HTML, RTF) a one-file change.
    """

    @abc.abstractmethod
    def parse(self, data: bytes, filename: str = "") -> str:
        """
        Extract plain text from raw file bytes.

        Args:
            data:     Raw bytes of the uploaded file.
            filename: Original filename (used for logging/debugging only).

        Returns:
            Plain text extracted from the document.
            Returns an empty string if nothing could be extracted.
        """
