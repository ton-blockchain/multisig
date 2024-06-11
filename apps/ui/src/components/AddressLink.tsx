import { Address } from "@ton/core";

export const AddressLink = (props: { address: string }) => {
  const friendlyAddress = Address.parse(props.address).toString({
    urlSafe: true,
    bounceable: true,
  });

  return (
    <a
      href={`https://tonviewer.com/${friendlyAddress}`}
      target="_blank"
      rel="noreferrer"
    >
      {friendlyAddress}
    </a>
  );
};

