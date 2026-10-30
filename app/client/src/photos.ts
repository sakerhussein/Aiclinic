// Free-license photos from Pexels (https://www.pexels.com/license/).
// They load from Pexels' image servers. To self-host later, download each photo
// into client/public/photos/ and change photoUrl() to return the local path.

export const PHOTOS = {
  hero: { pexelsId: 3952125, by: "Andrea Piacquadio" },
  assessment: { pexelsId: 4266944, by: "Cedric Fauntleroy" },
  dental: { pexelsId: 3845810, by: "Anna Shvets" },
  derm: { pexelsId: 7446660, by: "Gustavo Fring" },
  family: { pexelsId: 5215016, by: "Antoni Shkraba" },
  peds: { pexelsId: 5998450, by: "Pavel Danilyuk" },
  physio: { pexelsId: 20860607, by: "Funkcinės Terapijos Centras" },
  mental: { pexelsId: 4101143, by: "cottonbro studio" },
  consulting: { pexelsId: 8292880, by: "RDNE Stock project" },
} as const;

export type PhotoId = keyof typeof PHOTOS;

export function photoUrl(pexelsId: number, width: number): string {
  return `https://images.pexels.com/photos/${pexelsId}/pexels-photo-${pexelsId}.jpeg?auto=compress&cs=tinysrgb&w=${width}`;
}
