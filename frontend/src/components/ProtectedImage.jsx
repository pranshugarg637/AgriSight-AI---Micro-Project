import { useEffect, useState } from "react";
import { fetchImageUrl } from "../api/account";

export default function ProtectedImage({ path, alt, className }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    let made = null;
    fetchImageUrl(path)
      .then((u) => {
        made = u;
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url ? <img src={url} alt={alt} className={className} /> : null;
}
