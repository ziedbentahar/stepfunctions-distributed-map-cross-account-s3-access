import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client();

export const handler = async (event: { Items: string[] }) => {
  await Promise.all(
    event.Items.map(async (key) => {
      const object = await s3Client.send(
        new GetObjectCommand({
          Key: key,
          Bucket: process.env.SOURCE_BUCKET,
        })
      );

      const objectContent = await object.Body.transformToString("utf-8");

      await processObjectObjectContent(objectContent);
    })
  );
};

function processObjectObjectContent(objectContent: string) {
  // do something with object content
  console.log(JSON.stringify(objectContent));
}
