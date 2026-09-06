// pons v2 on Robinhood Chain and the Uniswap v4 pieces its graduated pools use. Addresses and
// ABIs as verified by the  project (docs.ponsfamily.com/v2, Blockscout, the pons repo).
// Pure data: no clients here, so the hub and the browser share it.

import { parseAbi, toEventSelector, toFunctionSelector, type Address } from 'viem';

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const ROBINHOOD_WS = 'wss://robinhood-rpc.publicnode.com';
export const ROBINHOOD_EXPLORER = 'https://robinhoodchain.blockscout.com';
/** Canonical Multicall3 (verified live 2026-09-03 by ). */
export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const PONS = {
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address,
  router: '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948' as Address,
  deployer: '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42' as Address,
  escrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e' as Address,
  hook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044' as Address,
  locker: '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952' as Address,
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address,
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
  v4PoolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' as Address,
  v4Quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as Address,
  v4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b' as Address,
  universalRouter: '0x8876789976decbfcbbbe364623c63652db8c0904' as Address,
} as const;

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD';

export const factoryAbi = parseAbi([
  'struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
  'function snipeTaxStartBps() view returns (uint256)',
  'function snipeTaxSeconds() view returns (uint256)',
  'function launchEnabled() view returns (bool)',
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  'event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)',
]);

export const curveAbi = parseAbi([
  'function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)',
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function realQuoteReserve() view returns (uint256)',
  'function sellableTokens() view returns (uint256)',
  'function reservedTokens() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function readyToGraduate() view returns (bool)',
  'function graduated() view returns (bool)',
  'function feeBps() view returns (uint256)',
  'function creatorTaxBps() view returns (uint256)',
  'function launchedAt() view returns (uint256)',
  'function currentSnipeTaxBps(address recipient) view returns (uint256)',
  'event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)',
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)',
]);

export const tokenAbi = parseAbi([
  'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }',
  'function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

export const routerAbi = parseAbi([
  'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }',
  'struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }',
  'function launchAndBuy(TokenParams params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)',
]);

export const universalRouterAbi = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
export const v4QuoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
]);
export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

export const TOPIC = {
  tokenLaunched: toEventSelector('TokenLaunched(address,address,address,address,uint256,uint256)'),
  snipeTaxCharged: '0x3bc39a5562b28f5fe8f36cecabfbaa12bb969acf05717994709225fc412a9934' as const,
} as const;
export const SELECTOR = {
  launchAndBuy: toFunctionSelector('launchAndBuy((string,string,string,string,(string,string,string,string,string),address,uint16,bool,bytes32,bytes32),uint256,address,uint256,uint256,address,address[])'),
} as const;

export const PHASE_NAME = ['curve', 'swept', 'pool', 'rescued'] as const;
export const BPS = 10_000n;
/** 1B tokens, the only launch config live on 2026-09-03 (id 0). */
export const SUPPLY = 1_000_000_000n * 10n ** 18n;
