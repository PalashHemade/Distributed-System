const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.AWS_S3_BUCKET;

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  // Falls back to the default AWS credential chain (e.g. an EC2 instance role)
  // when AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY aren't set.
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

function assertConfigured() {
  if (!BUCKET) {
    throw new Error('AWS_S3_BUCKET is not set — resource upload/download requires S3 to be configured in .env');
  }
}

async function uploadBuffer(key, buffer, contentType) {
  assertConfigured();
  const upload = new Upload({
    client: s3Client,
    params: { Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType },
  });
  await upload.done();
  return { bucket: BUCKET, key };
}

async function getPresignedDownloadUrl(key, expiresInSeconds = 900) {
  assertConfigured();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

async function deleteObject(key) {
  assertConfigured();
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { uploadBuffer, getPresignedDownloadUrl, deleteObject, BUCKET };
