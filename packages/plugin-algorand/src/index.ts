import { Plugin } from "@elizaos/core";
import { transferAlgo } from "./actions/transfer";
import { WalletProvider, algorandWalletProvider } from "./providers/wallet";

export { WalletProvider, transferAlgo as TransferAlgoToken };

export const algorandPlugin: Plugin = {
    name: "algorand",
    description: "Algorand Plugin for Eliza",
    actions: [transferAlgo],
    providers: [algorandWalletProvider],
    evaluators: [],
};

export default algorandPlugin;
