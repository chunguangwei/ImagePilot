// Preserve classification evidence and existing descriptions when recording a caption failure.
export function captionRecordFields(image, status, message) {
  return {
    id: image.id,
    uri: image.uri,
    mobileNetV3Detections: {
      ...image.mobileNetV3Detections,
      embedding: {
        ...image.mobileNetV3Detections?.embedding,
        caption: { model: 'lfm2.5-vl-450m', ...status },
      },
    },
    ...(message === undefined ? {} : { message }),
  };
}
