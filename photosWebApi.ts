import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as setCookieParser from 'set-cookie-parser';
import betterSqlite3 from 'better-sqlite3';
import sqlite3 from 'sqlite3';
import { CookieJar } from 'tough-cookie';
import { promisify } from 'util';
import { preparedBatchExecute } from './batchexecute/encode';
import { parseBatchExecuteResponse } from './batchexecute/decode';

export class PhotosWebApi {
    private axiosInstance: AxiosInstance;
    private cookieJar: CookieJar;
    linkDb?: betterSqlite3.Database;

    constructor() {
        this.cookieJar = new CookieJar();
        this.axiosInstance = wrapper(axios.create({
            maxRedirects: 0, // Do not follow redirects
            validateStatus: function (status) {
                return status >= 200 && status < 303; // Accepts 200-302 status codes
            },
            withCredentials: true,
            jar: this.cookieJar,
        }));

        // this.axiosInstance.interceptors.request.use((request) => {
        //     console.log('Starting Request', JSON.stringify(request, null, 2));
        //     return request;
        // });
    }

    initDb() {
        if (this.linkDb) {
            return this.linkDb;
        }

        const linkDbPath = 'links.sqlite';
        this.linkDb = new betterSqlite3(linkDbPath);
        this.linkDb.exec(`CREATE TABLE IF NOT EXISTS links (mediaItemUrl TEXT PRIMARY KEY, privateUrl TEXT NOT NULL);`);
        this.linkDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_links_privateUrl ON links(privateUrl);`);

        return this.linkDb;
    }

    async closeDb() {
        if (this.linkDb) {
            this.linkDb.close();
        }
    }

    getCachedPrivateItemUrl(mediaItemUrl: string): string | undefined {
        const db = this.initDb();

        const preparedRead = db.prepare('SELECT privateUrl FROM links WHERE mediaItemUrl = ?');
        const row: any = preparedRead.get(mediaItemUrl);
        return row?.privateUrl;
    }

    saveCachedUrlMapping(mediaItemUrl: string, privateUrl: string) {
        const db = this.initDb();

        const preparedWrite = db.prepare('INSERT INTO links(mediaItemUrl, privateUrl) VALUES(?, ?) ON CONFLICT (privateUrl) DO UPDATE SET privateUrl = ?');
        preparedWrite.run(mediaItemUrl, privateUrl, privateUrl);
    }

    cookieFromRecord(record: Record<string, any>) {
        return `${record.name}=${record.value}; Domain=${record.host ?? record.domain}; ${record.secure ? 'Secure; ' : ''}Path=${record.path}; Expires=${record.expires.toUTCString()}`;
    }

    async loadCookiesFromFirefoxDb() {
        const dbPath = process.env.FIREFOX_COOKIES_DB_PATH;
        if (!dbPath) {
            throw new Error("FIREFOX_COOKIES_DB_PATH environment variable must be set");
        }

        const db = new sqlite3.Database(dbPath);

        const dbCloseAsync = promisify(db.close.bind(db));
        await new Promise<void>((fulfil, reject) => {
            db.each("SELECT name, value, host, path, expiry, isSecure FROM moz_cookies ORDER BY expiry ASC", (err, row: Record<string, any>) => {
                if (err) {
                    throw err;
                }
                if (!row.host.endsWith('.google.com')) {
                    return;
                }

                const isSecure = row.isSecure === 1;
                const cookie = this.cookieFromRecord({
                    name: row.name,
                    value: row.value,
                    host: row.host,
                    path: row.path,
                    expires: new Date(row.expiry * 1000),
                    secure: isSecure
                });
                this.cookieJar.setCookieSync(cookie, `${isSecure ? 'https://' : 'http://'}${row.host}`);
            }, (err, count) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(count, 'rows');
                    fulfil();
                }
            });
        });
        await dbCloseAsync();
    }

    async _requestPrivateItemUrlWithRetries(url: string) {
        function delay(ms: number) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        const maxAttempts = 6;
        const maxDelayTime = 10 * 60000; // 10 minutes
        const enableDelay = false;
        let attempts = 0;
        let delayTime = 60000; // Start with 1 minute

        while (attempts < maxAttempts) {
            try {
                const response = await this.axiosInstance.get(url);

                if (response.status !== 301 && response.status !== 302) {
                    throw new Error(`Unexpected status code ${response.status}`);
                }

                const loc = response.headers.location; // Returns the 301 redirect location

                if (loc.startsWith('https://accounts.google.com')) {
                    throw new Error("Not logged in");
                }

                return response;
            } catch (error) {
                attempts++;
                console.error(error);
                if (enableDelay) {
                    console.error(`Attempt ${attempts} to fetch media item failed. Retrying after ${delayTime / 1000}s...`);
                    await delay(delayTime);
                    delayTime *= 2; // Double the delay time for the next attempt
                    if (delayTime > maxDelayTime) { // Limit the delay time to 5 minutes
                        delayTime = maxDelayTime;
                    }
                }
            }
        }

        throw new Error('Could not fetch media item.');
    }

    getCachedMediaItemUrl(privateUrl: string) {
        const db = this.initDb();

        const preparedRead = db.prepare('SELECT mediaItemUrl FROM links WHERE privateUrl = ?');
        const row: any = preparedRead.get(privateUrl);
        return row?.mediaItemUrl;
    }

    async fetchPrivateItemUrl(mediaItemUrl: string) {
        const cachedUrl = this.getCachedPrivateItemUrl(mediaItemUrl);

        if (cachedUrl) {
            return cachedUrl;
        }

        const response = await this._requestPrivateItemUrlWithRetries(mediaItemUrl);
        const loc = response.headers.location; // Returns the 301 redirect location

        if (response.headers['set-cookie']) {
            const cookies = setCookieParser.parse(response.headers['set-cookie'], {
                decodeValues: true
            });

            for (const cookie of cookies) {
                cookie.domain = cookie.domain ?? new URL(mediaItemUrl).hostname;
                const cookieString = this.cookieFromRecord(cookie);

                await this.cookieJar.setCookie(cookieString, mediaItemUrl);
            }
        }

        this.saveCachedUrlMapping(mediaItemUrl, loc);

        return loc;
    }

    async addMediaItemsToAlbum(albumId: string, mediaItemIds: string[]) {
        const chunkSize = 50;

        for (let i = 0; i < mediaItemIds.length; i += chunkSize) {
            const chunk = mediaItemIds.slice(i, i + chunkSize);

            const ADD_PHOTOS_TO_ALBUM_RPC_ID = 'E1Cajb';

            const { url, headers, body } = preparedBatchExecute({
                host: "photos.google.com",
                app: "PhotosUi",
                rpcs: [
                    {
                        id: ADD_PHOTOS_TO_ALBUM_RPC_ID,
                        args: [
                            chunk,
                            albumId
                        ]
                    }
                ]
            });

            url.searchParams.append('hl', 'en-US');
            url.searchParams.append('source-path', '/');

            // This might be unnecessary - it's going to get outdated quickly anyway
            // url.searchParams.append('bl', 'boq_photosuiserver_20240212.05_p2');

            const wizSid = process.env.WIZ_SID;
            if (!wizSid) {
                throw new Error("WIZ_SID environment variable must be set");
            }
            url.searchParams.append('f.sid', wizSid);

            const wizAt = process.env.WIZ_AT;
            if (!wizAt) {
                throw new Error("WIZ_AT environment variable must be set");
            }
            body.append('at', wizAt);
            // end

            console.log(url.toString());
            console.log(body.toString());
            console.log('');

            try {
                const response = await this.axiosInstance.post(url.toString(), body, {
                    headers: headers
                });

                const parsedResponse = parseBatchExecuteResponse(response.data);

                if(!parsedResponse?.[0]?.data) {
                    console.error(new Error("Empty response for chunk beginning" + chunk[0] + " - some items may not have been added to the album!"));
                }

                // console.log(JSON.stringify(parsedResponse, null, 2));
                console.log('Done', i, "of", mediaItemIds.length);
            } catch (error) {
                console.error(error);
                throw error;
            }
        }
    }
}