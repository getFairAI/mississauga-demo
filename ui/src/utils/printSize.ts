export const printSize = (args: File | number) => {
  let size;
  if (typeof args === 'number') {
    size = args;
  } else {
    size = args.size;
  }

  const kb = 1024;
  const mbElevation = 2;
  const mb = Math.pow(kb, mbElevation);
  const gbElevation = 3;
  const gb = Math.pow(kb, gbElevation);
  const divider = 100;

  if (size < kb) {
    return `${size} bytes`;
  } else if (size < mb) {
    const kbSize = size / kb;
    return `${Math.round((kbSize + Number.EPSILON) * divider) / divider} KB`;
  } else if (size < gb) {
    const mbSize = size / mb;
    return `${Math.round((mbSize + Number.EPSILON) * divider) / divider} MB`;
  } else {
    const gbSize = size / gb;
    return `${Math.round((gbSize + Number.EPSILON) * divider) / divider} GB`;
  }
};
