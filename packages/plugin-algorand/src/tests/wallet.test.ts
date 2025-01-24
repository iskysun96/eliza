import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { WalletProvider } from "../providers/wallet";

import { defaultCharacter } from "@elizaos/core";
import BigNumber from "bignumber.js";

import * as algokit from "@algorandfoundation/algokit-utils";

// Mock NodeCache
vi.mock("node-cache", () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            set: vi.fn(),
            get: vi.fn().mockReturnValue(null),
        })),
    };
});

// Mock path module
vi.mock("path", async () => {
    const actual = await vi.importActual("path");
    return {
        ...actual,
        join: vi.fn().mockImplementation((...args) => args.join("/")),
    };
});

// Mock the ICacheManager
const mockCacheManager = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    delete: vi.fn(),
};

describe("WalletProvider", () => {
    let walletProvider: WalletProvider;
    let mockedRuntime;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockCacheManager.get.mockResolvedValue(null);

        const algorandClient = algokit.AlgorandClient.defaultLocalNet();
        const algoAccount = await algorandClient.account.random();

        // Fund randomly created localnet account with 100 ALGO
        const localDispenserAccount =
            await algorandClient.account.localNetDispenser();
        algorandClient.account.ensureFunded(
            algoAccount.addr,
            localDispenserAccount.addr,
            algokit.algo(100)
        );

        // Create new instance of TokenProvider with mocked dependencies
        walletProvider = new WalletProvider(
            algorandClient,
            algoAccount,
            mockCacheManager
        );

        mockedRuntime = {
            character: defaultCharacter,
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
    });

    describe("Wallet Integration", () => {
        it("should check wallet address", async () => {
            const result =
                await walletProvider.getFormattedPortfolio(mockedRuntime);

            const prices = await walletProvider.fetchPrices();
            const accountInfo =
                await walletProvider.algorandClient.account.getInformation(
                    walletProvider.algoAccount.addr
                );
            const algoAmount = new BigNumber(accountInfo.balance.algo).toFixed(
                6
            );
            const totalUsd = new BigNumber(algoAmount)
                .times(prices.algo.usd)
                .toFixed(2);
            expect(result).toEqual(
                `Eliza\nWallet Address: ${walletProvider.algoAccount.addr}\n` +
                    `Total Value: $${totalUsd} (${algoAmount} ALGO)\n`
            );
        });
    });
});
