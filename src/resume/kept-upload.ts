/*
 * Which file "Download original" hands back (#590). A resume is one row with
 * one file, and Save as vN writes the next version into it: the file the
 * person uploaded — a .md, a designed PDF — was gone with the first save. So
 * the row keeps that upload beside the file ApplyPack wrote, and the next file
 * the person uploads is the original again. Pure: the row's columns in, the
 * columns to write or the file to send out.
 */

export interface ResumeFiles {
  original: Uint8Array<ArrayBuffer>;
  sourceFilename: string;
  mimeType: string;
  uploadFile: Uint8Array<ArrayBuffer> | null;
  uploadName: string | null;
  uploadMime: string | null;
}

type UploadColumns = Pick<ResumeFiles, 'uploadFile' | 'uploadName' | 'uploadMime'>;

/** A version the person uploads is the original itself: nothing is kept beside it. */
export const NOTHING_KEPT: UploadColumns = { uploadFile: null, uploadName: null, uploadMime: null };

/** A version ApplyPack writes keeps the upload it replaces; one an earlier save kept stays as it is. */
export function keptByWrite(row: ResumeFiles): Partial<UploadColumns> {
  if (row.uploadFile !== null) return {};
  return { uploadFile: row.original, uploadName: row.sourceFilename, uploadMime: row.mimeType };
}

/** The file "Download original" sends: the kept upload, else the file in place. */
export function originalFile(row: ResumeFiles): { name: string; mime: string; bytes: Uint8Array<ArrayBuffer> } {
  if (row.uploadFile === null) return { name: row.sourceFilename, mime: row.mimeType, bytes: row.original };
  return { name: row.uploadName ?? row.sourceFilename, mime: row.uploadMime ?? row.mimeType, bytes: row.uploadFile };
}
