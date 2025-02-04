import "@babel/polyfill"
import Aragon, { events } from "@aragon/api"
import retryEvery from "./lib/retry-every"
import {
    agentAddress$,
    agentApp$,
    allEnabledTokensExchanges$,
    uniswapFactoryAddress$
} from "./web3/ExternalContracts"
import { agentInitializationBlock$, agentBalances$ } from "./web3/AgentData"
import { ETHER_TOKEN_FAKE_ADDRESS } from "./lib/shared-constants"
import { uniswapTokens$ } from "./web3/UniswapData"

const DEBUG_LOGS = true
const debugLog = message => {
    if (DEBUG_LOGS) {
        console.debug(message)
    }
}

const activeTokens = state => state ? state.activeTokens ? state.activeTokens : [] : []

const api = new Aragon()

// Wait until we can get the agent address (demonstrating we are connected to the app) before initializing the store.
retryEvery(retry => {
    agentAddress$(api).subscribe(
        () => initialize(),
        error => {
            console.error(
                "Could not start background script execution due to the contract not loading the agent address:",
                error
            )
            retry()
        }
    )
})

async function initialize() {
    api.store(onNewEventCatchError, {
        init: initialState,
        externals: [
            {
                contract: await agentApp$(api).toPromise(),
                initializationBlock: await agentInitializationBlock$(api).toPromise()
            },
            ...await allEnabledTokensExchanges$(api).toPromise()

        ]
    })
}

const initialState = async (cachedInitState) => {
    try {
        return {
            ...cachedInitState,
            isSyncing: true,
            agentAddress: await agentAddress$(api).toPromise(),
            uniswapFactoryAddress: await uniswapFactoryAddress$(api).toPromise(),
            balances: await agentBalances$(api, activeTokens(cachedInitState)).toPromise(),
            uniswapTokens: await uniswapTokens$(api).toPromise()
        }
    } catch (e) {
        console.error(`Script init error: ${error}`)
        return state
    }
}

const onNewEventCatchError = async (state, event) => {
    try {
        return await onNewEvent(state, event)
    } catch (error) {
        console.error(`Script event error: ${error}`)
    }
}

const onNewEvent = async (state, storeEvent) => {

    const {
        event: eventName,
        address: eventAddress,
        returnValues: eventParams
    } = storeEvent

    // console.log("Store Event:")
    // console.log(storeEvent)

    // console.log("Current state:")
    // console.log(state)

    switch (eventName) {
        case events.SYNC_STATUS_SYNCING:
            debugLog("APP SYNCING")
            return {
                ...state,
                isSyncing: true
            }
        case events.SYNC_STATUS_SYNCED:
            debugLog("APP DONE SYNCING")
            return {
                ...state,
                isSyncing: false
            }
        case "AppInitialized":
            debugLog("APP CONSTRUCTOR EVENT")
            api.identify(eventAddress)
            return {
                ...state,
                appAddress: eventAddress
            }
        case "NewAgentSet":
            debugLog("NEW AGENT SET")
            return {
                ...state,
                agentAddress: await agentAddress$(api).toPromise(),
                balances: await agentBalances$(api, activeTokens(state)).toPromise()
            }
        case "NewUniswapFactorySet":
            debugLog("NEW UNISWAP FACTORY SET")
            return {
                ...state,
                uniswapFactoryAddress: await uniswapFactoryAddress$(api).toPromise(),
                uniswapTokens: await uniswapTokens$(api).toPromise()
            }
        case "VaultTransfer":
        case "VaultDeposit":
            debugLog("AGENT TRANSFER")
            const { token } = eventParams
            const activeTokensWithToken = newActiveTokens(state, token)
            return {
                ...state,
                balances: await agentBalances$(api, activeTokensWithToken).toPromise(),
                activeTokens: activeTokensWithToken
            }
        case "ProxyDeposit":
            debugLog("ETH DEPOSIT")
            return {
                ...state,
                balances: await agentBalances$(api, activeTokens(state)).toPromise()
            }
        case "EthToTokenSwapInput":
        case "TokenToEthSwapInput":
            debugLog("ETH TO TOKEN SWAP INPUT")
            const { tokenTransferred } = eventParams
            const activeTokensWithTokenReturned = newActiveTokens(state, tokenTransferred)
            return {
                ...state,
                balances: await agentBalances$(api, activeTokensWithTokenReturned).toPromise(),
                activeTokens: activeTokensWithTokenReturned
            }
        case "TokenPurchase":
            debugLog("TOKEN PURCHASE")
            const { eth_sold, tokens_bought } = eventParams
            return {
                ...state,
                tokenSwaps: await newTokenSwaps(state, storeEvent, "ETH_TO_TOKEN", eth_sold, tokens_bought)
            }
        case "EthPurchase":
            debugLog("ETH PURCHASE")
            const { eth_bought, tokens_sold } = eventParams
            return {
                ...state,
                tokenSwaps: await newTokenSwaps(state, storeEvent, "TOKEN_TO_ETH", tokens_sold, eth_bought)
            }
        default:
            return state
    }
}

const newActiveTokens = (state, newToken) => {
    const newActiveTokens = [...state.activeTokens || []]
    if (newToken !== ETHER_TOKEN_FAKE_ADDRESS) {
        newActiveTokens.push(newToken)
    }
    return [...new Set(newActiveTokens)]
}

const newTokenSwaps = async (state, storeEvent, type, input, output) => {
    const { blockNumber, address } = storeEvent

    const newTokenSwaps = [...state.tokenSwaps || []]

    if (state.agentAddress === storeEvent.returnValues.buyer) {
        const { timestamp: blockTimestamp } = await api.web3Eth("getBlock", blockNumber).toPromise()
        newTokenSwaps.push({
            type: type,
            input: input,
            output: output,
            timestamp: blockTimestamp,
            exchangeAddress: address
        })
    }

    return newTokenSwaps
}
