// Graduated pons tokens live in Uniswap v4 pools keyed {ETH, token, fee 0, tickSpacing 200,
// hooks = pons meme hook}. Swaps go through the UniversalRouter V4_SWAP command with
// SWAP_EXACT_IN_SINGLE + SETTLE_ALL + TAKE_ALL. Pure encoding; the caller simulates/sends.

import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbiParameters, type Address, type Hex } from 'viem';
import { PONS, ZERO_ADDRESS, universalRouterAbi } from './abi.js';

export interface PoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }

export function ponsPoolKey(token: Address, pairToken: Address = ZERO_ADDRESS, tickSpacing = 200, hooks: Address = PONS.hook): PoolKey {
  const [c0, c1] = BigInt(token) < BigInt(pairToken) ? [token, pairToken] : [pairToken, token];
  return { currency0: c0, currency1: c1, fee: 0, tickSpacing, hooks };
}

export const poolId = (k: PoolKey): Hex => keccak256(encodeAbiParameters(parseAbiParameters('address, address, uint24, int24, address'), [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

/** universal-router Commands.sol / v4-periphery Actions.sol */
const Command = { V4_SWAP: 0x10 } as const;
const Action = { SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;

export type RouterLayout = 'current' | 'legacy';
const SWAP_CURRENT = parseAbiParameters('((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)');
const SWAP_LEGACY = parseAbiParameters('((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)');

export interface SwapCall { to: Address; data: Hex; value: bigint }

/** Calldata for one exact-input single-hop v4 swap through the UniversalRouter. */
export function encodeV4Swap(key: PoolKey, zeroForOne: boolean, amountIn: bigint, amountOutMin: bigint, layout: RouterLayout, deadlineSec = Math.floor(Date.now() / 1000) + 60): SwapCall {
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [Action.SWAP_EXACT_IN_SINGLE, Action.SETTLE_ALL, Action.TAKE_ALL]);
  const swap = layout === 'current'
    ? encodeAbiParameters(SWAP_CURRENT, [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: amountOutMin, minHopPriceX36: 0n, hookData: '0x' }])
    : encodeAbiParameters(SWAP_LEGACY, [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: amountOutMin, hookData: '0x' }]);
  const cIn = zeroForOne ? key.currency0 : key.currency1;
  const cOut = zeroForOne ? key.currency1 : key.currency0;
  const settle = encodeAbiParameters(parseAbiParameters('address, uint256'), [cIn, amountIn]);
  const take = encodeAbiParameters(parseAbiParameters('address, uint256'), [cOut, amountOutMin]);
  const input = encodeAbiParameters(parseAbiParameters('bytes, bytes[]'), [actions, [swap, settle, take]]);
  const data = encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: [encodePacked(['uint8'], [Command.V4_SWAP]), [input], BigInt(deadlineSec)] });
  return { to: PONS.universalRouter, data, value: cIn === ZERO_ADDRESS ? amountIn : 0n };
}
