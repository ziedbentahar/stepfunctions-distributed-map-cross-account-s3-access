import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const s3Client = new S3Client();

export const handler = async (event: {
  listBucketOutputFileName: string;
  prefix: string;
}) => {
  const keyList = await getKeysFromBucketByPrefix(
    process.env.SOURCE_BUCKET,
    event.prefix || ""
  );

  await writeKeysAsJSONIntoBucket(
    process.env.TARGET_BUCKET,
    event.listBucketOutputFileName,
    keyList
  );
};

const getKeysFromBucketByPrefix = async (bucket: string, prefix: string) => {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  });

  try {
    let isTruncated = true;
    let keys: string[] = [];

    while (isTruncated) {
      const { Contents, IsTruncated, NextContinuationToken } =
        await s3Client.send(command);

      keys.push(...Contents.map((c) => c.Key));
      isTruncated = IsTruncated;
      command.input.ContinuationToken = NextContinuationToken;
    }

    return keys;
  } catch (err) {
    console.error(err);
    return [];
  }
};

const writeKeysAsJSONIntoBucket = async (
  bucket: string,
  fileKey: string,
  keys: string[]
) => {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      Body: JSON.stringify(keys),
    })
  );
};
