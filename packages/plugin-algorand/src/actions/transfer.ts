import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    composeContext,
    elizaLogger,
    generateObject,
    Action,
} from "@elizaos/core";
import { z } from "zod";

import * as algokit from "@algorandfoundation/algokit-utils";
import {
    SigningAccount,
    TransactionSignerAccount,
} from "@algorandfoundation/algokit-utils/types/account";
import { Address, Account } from "algosdk";

import { algorandWalletProvider } from "../providers/wallet";
import { transferTemplate } from "../templates";

type Network = "mainnet" | "testnet" | "localnet";

export interface TransferContent extends Content {
    recipient: string;
    amount: string | number;
}

function isTransferContent(content: Content): content is TransferContent {
    console.log("Content for transfer", content);
    return (
        typeof content.recipient === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

export const transferAlgo: Action = {
    name: "SEND_TOKEN",
    description: "Transfer ALGO from the agent's wallet to another address",
    similes: [
        "TRANSFER",
        "TRANSFER_TOKEN",
        "TRANSFER_TOKENS",
        "SEND_TOKENS",
        "SEND_ALGO",
        "TRANSFER_ALGO",
        "TRANSFER_ALGOs",
        "PAY",
    ],
    validate: async (runtime: IAgentRuntime) => {
        return !!runtime.character.settings.secrets?.ALGORAND_ACCOUNT_MNEMONIC;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: any,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SEND_TOKEN handler...");

        // Initialize or update state
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        const walletInfo = await algorandWalletProvider.get(
            runtime,
            message,
            state
        );
        state.walletInfo = walletInfo;

        // Define the schema for the expected output
        const transferSchema = z.object({
            recipient: z.string(),
            amount: z.union([z.string(), z.number()]),
        });

        const transferContext = composeContext({
            state,
            template: transferTemplate,
        });

        const content = await generateObject({
            runtime,
            context: transferContext,
            modelClass: ModelClass.SMALL,
            schema: transferSchema,
        });

        const transferContent = content.object as TransferContent;

        // Validate transfer content
        if (!isTransferContent(transferContent)) {
            console.error("Invalid content for TRANSFER_TOKEN action.");
            if (callback) {
                callback({
                    text: "Unable to process transfer request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            // get algorand account object and network, algorand client
            const network = runtime.getSetting("ALGORAND_NETWORK") as Network;
            const mnemonic = runtime.getSetting("ALGORAND_MNEMONIC");

            let algorandClient: algokit.AlgorandClient;
            let algoAccount: Address &
                TransactionSignerAccount & {
                    account: SigningAccount | Account;
                };
            if (network === "mainnet") {
                algorandClient = algokit.AlgorandClient.mainNet();
            } else if (network === "testnet") {
                algorandClient = algokit.AlgorandClient.testNet();
            } else {
                algorandClient = algokit.AlgorandClient.defaultLocalNet();
                algoAccount = algorandClient.account.random();

                // Fund randomly created localnet account with 100 ALGO
                const localDispenserAccount =
                    await algorandClient.account.localNetDispenser();
                algorandClient.account.ensureFunded(
                    algoAccount.addr,
                    localDispenserAccount.addr,
                    algokit.algo(100)
                );
            }

            // Retrieve account from mnemonic if not localnet
            algoAccount = algorandClient.account.fromMnemonic(mnemonic);

            const adjustedAmount = algokit.algos(
                Number(transferContent.amount)
            );
            console.log(
                `Transferring: ${transferContent.amount} ALGO (${adjustedAmount.microAlgo} microALGO)`
            );
            // send payment txn
            const txnResult = await algorandClient.send.payment({
                sender: algoAccount.addr,
                receiver: transferContent.recipient,
                amount: adjustedAmount,
            });

            console.log("Payment successful:", txnResult.txIds[0]);

            if (callback) {
                callback({
                    text: `Successfully transferred ${transferContent.amount} ALGO to ${transferContent.recipient}, Transaction ID: ${txnResult.txIds[0]}`,
                    content: {
                        success: true,
                        hash: txnResult.txIds[0],
                        amount: transferContent.amount,
                        recipient: transferContent.recipient,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during ALGO transfer:", error);
            if (callback) {
                callback({
                    text: `Error transferring ALGO: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 1 ALGO to DWFOAEYCIQLMMZWKCX2MAWTVBKTXYA2UNMVBTHTVBWQUZTUJRYX7LZAAU4",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "I'll send 1 ALGO now...",
                    action: "SEND_TOKEN",
                },
            },
            {
                user: "assistant",
                content: {
                    text: "Successfully transferred 1 ALGO to DWFOAEYCIQLMMZWKCX2MAWTVBKTXYA2UNMVBTHTVBWQUZTUJRYX7LZAAU4, Transaction ID: O2TKTT42ZDGLHZV2H6STEMLU3DYTYQJRCIQVRVVKFLFNQPNLE44A",
                },
            },
        ],
    ],
};
