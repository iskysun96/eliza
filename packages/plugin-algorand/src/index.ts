import { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
import { WalletProvider } from "./providers/wallet.ts";

export { WalletProvider, transferToken as TransferAptosToken };

export const algorandPlugin: Plugin = {
    name: "algorand",
    description: "Algorand Plugin for Eliza",
    actions: [transferAlgo],
    providers: [walletProvider],
    evaluators: [],
};

export default algorandPlugin;
