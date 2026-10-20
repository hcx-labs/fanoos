export type PlexStream = { id: number; streamType: number; codec?: string; language?: string; languageCode?: string; displayTitle?: string; key?: string; selected?: boolean };
export type PlexPart = { id: number; key: string; container?: string; Stream?: PlexStream[] };
export type PlexItem = {
 ratingKey: string; key?: string; type: string; title: string; summary?: string; thumb?: string; art?: string;
 parentRatingKey?: string; parentTitle?: string; parentIndex?: number; grandparentRatingKey?: string; grandparentTitle?: string; grandparentThumb?: string;
 librarySectionID?: number | string; librarySectionTitle?: string; index?: number; leafCount?: number; childCount?: number;
 duration?: number; addedAt?: number; originallyAvailableAt?: string; viewOffset?: number; viewCount?: number; contentRating?: string; year?: number;
 Media?: { width?: number; height?: number; bitrate?: number; videoResolution?: string; container?: string; videoCodec?: string; audioCodec?: string; Part?: PlexPart[] }[];
 Chapter?: { tag?: string; startTimeOffset: number; endTimeOffset?: number }[];
 Marker?: { type: string; startTimeOffset: number; endTimeOffset: number }[];
};
export type PlexContainer = { MediaContainer: { Metadata?: PlexItem[]; Directory?: PlexLibrary[]; Hub?: { Metadata?: PlexItem[] }[]; size?: number; totalSize?: number; offset?: number; machineIdentifier?: string; librarySectionID?: number; librarySectionTitle?: string } };
export type PlexLibrary = { key: string; title: string; type: string; thumb?: string; art?: string };
export type Resource = { name: string; clientIdentifier: string; provides: string; accessToken?: string; owned: boolean; connections: { uri: string; local: boolean; relay: boolean }[] };
export type Server = { id: string; name: string; url: string; token: string; clientId: string };
