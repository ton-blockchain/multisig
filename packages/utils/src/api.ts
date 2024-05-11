export const API_KEY =
  "d843619b379084d133f061606beecbf72ae2bf60e0622e808f2a3f631673599b";

export const sendToIndex = async (
  method: string,
  params: Record<string, string>,
  isTestnet: boolean,
) => {
  const mainnetRpc = "https://toncenter.com/api/v3/";
  const testnetRpc = "https://testnet.toncenter.com/api/v3/";
  const rpc = isTestnet ? testnetRpc : mainnetRpc;

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
  };

  const response = await fetch(
    `${rpc + method}?${new URLSearchParams(params)}`,
    {
      method: "GET",
      headers: headers,
    },
  );
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
};

export const sendToTonApi = async (
  method: string,
  params: Record<string, string>,
  isTestnet: boolean,
) => {
  const mainnetRpc = "https://dev.tonapi.io/v2/";
  const testnetRpc = "https://testnet.tonapi.io/v2/";
  const rpc = isTestnet ? testnetRpc : mainnetRpc;

  const headers = {
    "Content-Type": "application/json",
    Authorization:
      "Bearer AHIQH4F4Y4XR6UIAAAAOGYUHWOWLUS6ZIPEXSCLAPOMMD6FSNMPUKHCIJHIP52YTU4VKURA",
  };

  const response = await fetch(
    `${rpc + method}?${new URLSearchParams(params)}`,
    {
      method: "GET",
      headers: headers,
    },
  );
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error);
  }
  return json;
};
