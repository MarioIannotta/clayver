import { useEffect, useState } from "react";
import { formatBytes, getAttachmentUrl, isImageContentType, type Attachment } from "@clayver/core";
import { useClient } from "../clayver";

/** Image preview (linking to the full file) or a download link for other files. */
export function AttachmentView({ attachment }: { attachment: Attachment }) {
  const client = useClient();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    getAttachmentUrl(client, attachment.storagePath).then(
      (u) => !cancelled && setUrl(u),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [client, attachment.storagePath]);

  const isImage = isImageContentType(attachment.contentType) && attachment.contentType !== "image/heic";
  const meta = `${attachment.fileName} (${formatBytes(attachment.size)})`;

  if (error) {
    return (
      <span className="attachment attachment--error" title={error}>
        <FileIcon /> {attachment.fileName}: unavailable
      </span>
    );
  }

  if (isImage) {
    const ratio =
      attachment.width && attachment.height ? `${attachment.width} / ${attachment.height}` : undefined;
    return (
      <a className="attachment attachment--image" href={url ?? undefined} target="_blank" rel="noreferrer noopener" aria-label={`Open image ${meta}`}>
        {url ? (
          <img src={url} alt={attachment.fileName} loading="lazy" style={{ aspectRatio: ratio }} />
        ) : (
          <span className="attachment__placeholder" style={{ aspectRatio: ratio ?? "4 / 3" }} aria-hidden="true" />
        )}
      </a>
    );
  }

  return (
    <a
      className="attachment attachment--file"
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
      download={attachment.fileName}
      aria-disabled={!url}
    >
      <FileIcon />
      <span className="attachment__name">{attachment.fileName}</span>
      <span className="attachment__size">{formatBytes(attachment.size)}</span>
    </a>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
