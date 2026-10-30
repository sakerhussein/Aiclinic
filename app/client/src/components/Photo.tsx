import { PHOTOS, photoUrl, type PhotoId } from "../photos";

interface Props {
  id: PhotoId;
  alt: string;
  sizes?: string;
  eager?: boolean;
}

// Responsive photo from Pexels. The parent supplies a gradient background,
// so the layout still looks right if an image fails to load.
export default function Photo({ id, alt, sizes = "(max-width: 900px) 100vw, 50vw", eager = false }: Props) {
  const { pexelsId } = PHOTOS[id];
  return (
    <img
      src={photoUrl(pexelsId, 1200)}
      srcSet={`${photoUrl(pexelsId, 600)} 600w, ${photoUrl(pexelsId, 1200)} 1200w, ${photoUrl(pexelsId, 1800)} 1800w`}
      sizes={sizes}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
