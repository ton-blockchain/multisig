import { useNavigate } from "@solidjs/router";

export function useNavigateToHome(): () => void {
  const navigate = useNavigate();
  return (): void => {
    const homePage = "/";
    navigate(homePage);
  };
}

export function useNavigateToMultisigPage(): (multisigAddress: string) => void {
  const navigate = useNavigate();
  return (multisigAddress: string): void => {
    const multisigPage = "/multisig/:address";
    navigate(multisigPage.replace(":address", multisigAddress));
  };
}

export function useNavigateToStartScreen(): () => void {
  const navigate = useNavigate();
  return (): void => {
    const startScreenPage = "/start";
    navigate(startScreenPage);
  };
}

export function useNavigateToImportMultisigPage(): () => void {
  const navigate = useNavigate();
  return (): void => {
    const importMultisigPage = "/import-multisig";
    navigate(importMultisigPage);
  };
}

export function useNavigation(): {
  toHome: () => void;
  toMultisig: (multisigAddress: string) => void;
  toStartScreen: () => void;
  toImportMultisig: () => void;
} {
  return {
    toHome: useNavigateToHome(),
    toMultisig: useNavigateToMultisigPage(),
    toStartScreen: useNavigateToStartScreen(),
    toImportMultisig: useNavigateToImportMultisigPage(),
  };
}
