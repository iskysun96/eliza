import {
    Provider,
    IAgentRuntime,
    ICacheManager,
    Memory,
    State,
} from "@elizaos/core";

import * as algokit from "@algorandfoundation/algokit-utils";
import {
    SigningAccount,
    TransactionSignerAccount,
} from "@algorandfoundation/algokit-utils/types/account";
import { Address, Account } from "algosdk";

import NodeCache from "node-cache";
import BigNumber from "bignumber.js";
import * as path from "path";

type Network = "mainnet" | "testnet" | "localnet";

const PROVIDER_CONFIG = {
    MAX_RETRIES: 3,
    RETRY_DELAY: 2000,
};

interface WalletPortfolio {
    totalUsd: string;
    totalAlgo: string;
}

interface Prices {
    algo: { usd: string };
}

export class WalletProvider {
    private cache: NodeCache;
    private cacheKey: string = "algorand/wallet";
    algorandClient: algokit.AlgorandClient;
    algoAccount: Address &
        TransactionSignerAccount & {
            account: SigningAccount | Account;
        };

    constructor(
        algorandClient: algokit.AlgorandClient,
        algoAccount: Address &
            TransactionSignerAccount & {
                account: SigningAccount | Account;
            },
        private cacheManager: ICacheManager
    ) {
        this.algorandClient = algorandClient;
        this.algoAccount = algoAccount;

        this.cache = new NodeCache({ stdTTL: 300 }); // Cache TTL set to 5 minutes
    }

    private async readFromCache<T>(key: string): Promise<T | null> {
        const cached = await this.cacheManager.get<T>(
            path.join(this.cacheKey, key)
        );

        return cached;
    }

    private async writeToCache<T>(key: string, data: T): Promise<void> {
        await this.cacheManager.set(path.join(this.cacheKey, key), data, {
            expires: Date.now() + 5 * 60 * 1000,
        });
    }

    private async getCachedData<T>(key: string): Promise<T | null> {
        // Check in-memory cache first
        const cachedData = this.cache.get<T>(key);
        if (cachedData) {
            return cachedData;
        }

        // Check file-based cache
        const fileCachedData = await this.readFromCache<T>(key);
        if (fileCachedData) {
            // Populate in-memory cache
            this.cache.set(key, fileCachedData);
            return fileCachedData;
        }

        return null;
    }

    private async setCachedData<T>(cacheKey: string, data: T): Promise<void> {
        // Set in-memory cache
        this.cache.set(cacheKey, data);

        // Write to file-based cache
        await this.writeToCache(cacheKey, data);
    }

    private async fetchPricesWithRetry() {
        let lastError: Error;

        for (let i = 0; i < PROVIDER_CONFIG.MAX_RETRIES; i++) {
            try {
                const tinymanAlgoUsdcPoolAddr =
                    "2pifzw53rhcsfsymcfubw4xocxomb7xoyqsq6kgt3kvgjtl4hm6cozrnmm";
                const response = await fetch(
                    `https://api.dexscreener.com/latest/dex/pairs/algorand/${tinymanAlgoUsdcPoolAddr}`
                );

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(
                        `HTTP error! status: ${response.status}, message: ${errorText}`
                    );
                }

                const data = await response.json();
                return data;
            } catch (error) {
                console.error(`Attempt ${i + 1} failed:`, error);
                lastError = error;
                if (i < PROVIDER_CONFIG.MAX_RETRIES - 1) {
                    const delay = PROVIDER_CONFIG.RETRY_DELAY * Math.pow(2, i);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    continue;
                }
            }
        }

        console.error(
            "All attempts failed. Throwing the last error:",
            lastError
        );
        throw lastError;
    }

    async fetchPortfolioValue(): Promise<WalletPortfolio> {
        try {
            const cacheKey = `portfolio-${this.algoAccount.addr}`;
            const cachedValue =
                await this.getCachedData<WalletPortfolio>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPortfolioValue", cachedValue);
                return cachedValue;
            }
            console.log("Cache miss for fetchPortfolioValue");

            const prices = await this.fetchPrices().catch((error) => {
                console.error("Error fetching ALGO price:", error);
                throw error;
            });
            const algoAccountInfo = await this.algorandClient.account
                .getInformation(this.algoAccount.addr)
                .catch((error) => {
                    console.error("Error fetching ALGO account info:", error);
                    throw error;
                });

            const algoAmount = new BigNumber(algoAccountInfo.balance.algo);

            const totalUsd = new BigNumber(algoAmount).times(prices.algo.usd);

            const portfolio = {
                totalUsd: totalUsd.toString(),
                totalAlgo: algoAmount.toString(),
            };
            this.setCachedData(cacheKey, portfolio);
            console.log("Fetched portfolio:", portfolio);
            return portfolio;
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            throw error;
        }
    }

    async fetchPrices(): Promise<Prices> {
        try {
            const cacheKey = "prices";
            const cachedValue = await this.getCachedData<Prices>(cacheKey);

            if (cachedValue) {
                console.log("Cache hit for fetchPrices");
                return cachedValue;
            }
            console.log("Cache miss for fetchPrices");

            const algoPriceData = await this.fetchPricesWithRetry().catch(
                (error) => {
                    console.error("Error fetching ALGO price:", error);
                    throw error;
                }
            );
            const prices: Prices = {
                algo: { usd: (1 / algoPriceData.pair.priceNative).toString() },
            };
            this.setCachedData(cacheKey, prices);
            return prices;
        } catch (error) {
            console.error("Error fetching prices:", error);
            throw error;
        }
    }

    formatPortfolio(runtime, portfolio: WalletPortfolio): string {
        let output = `${runtime.character.name}\n`;
        output += `Wallet Address: ${this.algoAccount.addr}\n`;

        const totalUsdFormatted = new BigNumber(portfolio.totalUsd).toFixed(2);
        const totalAlgoFormatted = new BigNumber(portfolio.totalAlgo).toFixed(
            6
        );

        output += `Total Value: $${totalUsdFormatted} (${totalAlgoFormatted} ALGO)\n`;

        return output;
    }

    async getFormattedPortfolio(runtime): Promise<string> {
        try {
            const portfolio = await this.fetchPortfolioValue();
            return this.formatPortfolio(runtime, portfolio);
        } catch (error) {
            console.error("Error generating portfolio report:", error);
            return "Unable to fetch wallet information. Please try again later.";
        }
    }
}

export const algorandWalletProvider: Provider = {
    get: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ): Promise<string | null> => {
        const network = runtime.getSetting("ALGORAND_NETWORK") as Network;
        const mnemonic = runtime.getSetting("ALGORAND_MNEMONIC");
        let algoAccount: Address &
            TransactionSignerAccount & {
                account: SigningAccount | Account;
            };

        try {
            let algorandClient: algokit.AlgorandClient;

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

            const provider = new WalletProvider(
                algorandClient,
                algoAccount,
                runtime.cacheManager
            );
            return await provider.getFormattedPortfolio(runtime);
        } catch (error) {
            console.error("Error in wallet provider:", error);
            return null;
        }
    },
};
