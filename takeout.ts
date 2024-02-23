// Credit to https://webapps.stackexchange.com/a/172517 for the script this is adapted from

import * as fs from "fs";
import * as path from "path";

export interface MediaItem {
    title: string;
    webItemId: string;
    webUrl: string;
}

export interface TraversalResults {
    whatsApp: Record<string, MediaItem>
    partner: Record<string, MediaItem>
    otherCount: number;
    earliestDate?: Date;
    latestDate?: Date;
}

// Function to recursively traverse the file system
export function traverseDirectory(
    directory: string,
    resultsAcc: TraversalResults = { whatsApp: {}, partner: {}, otherCount: 0 }
): TraversalResults {
    const files = fs.readdirSync(directory);

    const isTrash = directory === "Takeout/Google Photos/Trash";

    if (isTrash) {
        return resultsAcc;
    }

    files.forEach((file: string) => {
        const filePath = path.join(directory, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            // If it's a directory, recursively traverse it and merge the results in
            traverseDirectory(filePath, resultsAcc);
        } else if (path.extname(file) === ".json") {
            // If it's a JSON file, read its content
            try {
                const jsonData = JSON.parse(fs.readFileSync(filePath, "utf8"));

                const localFolderName =
                    jsonData.googlePhotosOrigin?.mobileUpload?.deviceFolder
                        ?.localFolderName;
                const isWhatsApp =
                    localFolderName && localFolderName.includes("WhatsApp");
                const isPartnerPhoto = jsonData.googlePhotosOrigin?.fromPartnerSharing;

                if (!jsonData.title || !jsonData.url) {
                    return;
                }

                const timestampStr = jsonData.photoTakenTime?.timestamp;
                if (timestampStr) {
                    const timestamp = parseInt(timestampStr, 10) * 1000;

                    if (!isNaN(timestamp)) {
                        const dateTaken = new Date(timestamp);

                        if (!resultsAcc.earliestDate || dateTaken < resultsAcc.earliestDate) {
                            resultsAcc.earliestDate = dateTaken;
                        }

                        if (!resultsAcc.latestDate || dateTaken > resultsAcc.latestDate) {
                            resultsAcc.latestDate = dateTaken;
                        }
                    }
                }

                const item : MediaItem = {
                    title: jsonData.title,
                    webItemId: jsonData.url.split("/").pop(),
                    webUrl: jsonData.url
                };

                if (!item.webItemId) {
                    return;
                }

                if (isWhatsApp) {
                    resultsAcc.whatsApp[item.webItemId] = item;
                } else if (isPartnerPhoto) {
                    resultsAcc.partner[item.webItemId] = item;
                } else {
                    resultsAcc.otherCount++;
                }
            } catch (error) {
                console.error(`Error processing JSON file: ${filePath}`);
                console.error(error);
                throw error;
            }
        }
    });
    return resultsAcc;
}