import {enabledTokensAddresses$, tokenContract$, uniswapFactory$} from "./ExternalContracts";
import {range, zip} from "rxjs"
import {mergeMap, tap, toArray, map, filter, concatMap} from "rxjs/operators";
import {isTokenVerified$} from "./TokenVerification";
import {onErrorReturnDefault} from "../lib/rx-error-operators";

const allUniswapTokensAddresses$ = api =>
    uniswapFactory$(api).pipe(
        mergeMap(uniswapFactory => uniswapFactory.tokenCount().pipe(
            mergeMap(tokenCount => range(1, tokenCount)),
            mergeMap(tokenId => uniswapFactory.getTokenWithId(tokenId))
        ))
    )


const uniswapTokens$ = api => {

    const uniswapToken = (address, decimals, name, symbol, verified) => ({
        address,
        decimals,
        name,
        symbol,
        verified
    })

    return enabledTokensAddresses$(api).pipe(
        tap(console.log),
        concatMap(address => address),
        mergeMap(tokenAddress => tokenContract$(api, tokenAddress).pipe(
            mergeMap(token => zip(token.decimals(), token.name(), token.symbol(), isTokenVerified$(api, tokenAddress)).pipe(
                map(([decimals, name, symbol, verified]) => uniswapToken(tokenAddress, decimals, name, symbol, verified))
            ))
        )),
        toArray(),
        onErrorReturnDefault(`uniswapTokens`, [uniswapToken("", 0, "", "", false)])
    )
}

export {
    uniswapTokens$
}
