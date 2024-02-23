import { OAuth2Client } from "google-auth-library";
import axios from "axios";

interface MediaMetadata {
  creationTime: string;
  width: string;
  height: string;
  photo?: {
    cameraMake: string;
    cameraModel: string;
    focalLength: number;
    apertureFNumber: number;
    isoEquivalent: number;
    exposureTime: string;
  };
  video?: {
    fps: number;
    status: string;
  };
}

interface ContributorInfo {
  profilePictureBaseUrl: string;
  displayName: string;
}

interface MediaItem {
  id: string;
  productUrl: string;
  baseUrl: string;
  mimeType: string;
  mediaMetadata: MediaMetadata;
  contributorInfo: ContributorInfo;
  filename: string;
}

interface ListMediaItemsResponse {
  mediaItems: MediaItem[];
  nextPageToken: string;
}

const DEFAULT_PAGE_SIZE = 50;

export async function searchMediaItemsPage(
  oauth2Client: OAuth2Client,
  albumId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
  pageToken?: string
): Promise<ListMediaItemsResponse> {
  const url = "https://photoslibrary.googleapis.com/v1/mediaItems:search";

  const response = await axios.post(url, {
    albumId,
    pageSize,
    pageToken,
  },
    {
      headers: {
        Authorization: `Bearer ${oauth2Client.credentials.access_token}`,
        "Content-Type": "application/json",
      },
    });

  return response.data;
}

export async function* enumerateAlbumMediaItems(
  oauth2Client: OAuth2Client,
  albumId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
  skip?: number
) {
  let pageToken;
  let resultsCount = 0;

  do {
    const response = await searchMediaItemsPage(oauth2Client, albumId, pageSize, pageToken);

    if (skip && resultsCount < skip) {
      resultsCount += response.mediaItems.length;
      pageToken = response.nextPageToken;
      console.log(`Skipping ${resultsCount}/${skip} media items...`);
      continue;
    }

    if (!response.mediaItems) {
      return;
    }

    for (const mediaItem of response.mediaItems) {
      yield mediaItem;
      resultsCount++;
    }

    console.log('Fetched', resultsCount, 'media items');

    pageToken = response.nextPageToken;
  } while (pageToken);
}

export async function getOrCreateAlbum(oauth2Client: OAuth2Client, name: string) {
  const config = {
    headers: {
      Authorization: `Bearer ${oauth2Client.credentials.access_token}`,
      "Content-Type": "application/json",
    },
  };

  const { data: { albums } } = await axios.get('https://photoslibrary.googleapis.com/v1/albums', config);

  let album = albums.find((album: any) => album.title === name);

  if (!album) {
    const { data } = await axios.post(
      'https://photoslibrary.googleapis.com/v1/albums',
      { album: { title: name } },
      config
    );

    album = data;
  }

  return album.id;
}