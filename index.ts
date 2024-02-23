import dotenv from "dotenv";
import { googleAuth } from "./auth";
import { enumerateAlbumMediaItems, getOrCreateAlbum } from "./photosApi";
import { PhotosWebApi } from "./photosWebApi";
import { MediaItem, traverseDirectory } from "./takeout";

interface AlbumRecords {
  [key: string]: {
    albumName: string;
    id?: string;
    webItemId?: string;
    mediaItems: MediaItem[];
  };
}

async function main() {
  dotenv.config();

  const results = traverseDirectory("Takeout");
  const photosWebApi = new PhotosWebApi();

  console.log("Summary:");
  console.log(`Earliest date: ${results.earliestDate}`);
  console.log(`Latest date: ${results.latestDate}`);
  console.log(`${Object.keys(results.partner).length} partner photos`);
  console.log(`${Object.keys(results.whatsApp).length} WhatsApp photos`);
  console.log(`${results.otherCount} other photos`);
  const totalPhotos = Object.keys(results.partner).length + Object.keys(results.whatsApp).length + results.otherCount;
  console.log(`Total photos: ${totalPhotos}`);

  const oauth2Client = await googleAuth();
  const albums: AlbumRecords = {
    partner: { albumName: "Cleanup - Partner Photos", mediaItems: Object.values(results.partner) },
    whatsApp: { albumName: "Cleanup - WhatsApp Photos", mediaItems: Object.values(results.whatsApp) },
  };

  try {
    await photosWebApi.loadCookiesFromFirefoxDb();

    for (const album of Object.values(albums)) {
      const id = await getOrCreateAlbum(oauth2Client, album.albumName);

      album.id = id;
      const privateUrl = await photosWebApi.fetchPrivateItemUrl(`https://photos.google.com/lr/album/${id}`);
      album.webItemId = privateUrl.split("/").pop();
    }

    for (const [key, album] of Object.entries(albums)) {
      console.log(`Would add ${album.mediaItems.length} photos to album ${album.albumName} - filtering out items already in album...`);
      const withoutMediaIds: MediaItem[] = [];
      const byMediaId = album.mediaItems.reduce<Record<string, MediaItem>>((acc, item) => {

        const mediaItemUrl = photosWebApi.getCachedMediaItemUrl(item.webUrl);
        if (mediaItemUrl) {
          acc[mediaItemUrl.split("/").pop()] = item;
        } else {
          withoutMediaIds.push(item);
        }

        return acc;
      }, {});

      for await (const mediaItem of enumerateAlbumMediaItems(oauth2Client, album.id!)) {
        if (byMediaId[mediaItem.id]) {
          delete byMediaId[mediaItem.id];
        }
      }

      const filtered = [...withoutMediaIds, ...Object.values(byMediaId)].map(m => m.webItemId);

      console.log("Adding", filtered.length, "photos to album", album.albumName, "...");
      await photosWebApi.addMediaItemsToAlbum(album.webItemId!, filtered);
    }
  } finally {
    await photosWebApi.closeDb();
  }
}

if (require.main === module) {
  (async () => {
    try {
      await main();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  })();
}
