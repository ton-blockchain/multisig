import { Address } from "@ton/core";
import { Accessor, createMemo } from "solid-js";
import { Account } from "tonapi-sdk-js";

export const AddressLink = (props: {
  address: string;
  account?: Accessor<Account>;
  className?: string;
}) => {
  const friendlyAddress = createMemo(() =>
    Address.parse(props.address).toString({
      urlSafe: true,
      bounceable: !props?.account()?.is_wallet,
    }),
  );

  return (
    <a
      href={`https://tonviewer.com/${friendlyAddress()}`}
      target="_blank"
      rel="noreferrer"
      class={props.className}
    >
      {friendlyAddress()}
    </a>
  );
};
