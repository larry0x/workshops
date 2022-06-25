import * as path from "path";
import BN from "bn.js";
import chalk from "chalk";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { LocalTerra, MsgExecuteContract } from "@terra-money/terra.js";
import {
  toEncodedBinary,
  sendTransaction,
  storeCode,
  instantiateContract,
  queryNativeTokenBalance,
  queryTokenBalance,
} from "./helpers";

chai.use(chaiAsPromised);
const { expect } = chai;

//----------------------------------------------------------------------------------------
// Variables
//----------------------------------------------------------------------------------------

const terra = new LocalTerra();
const deployer = terra.wallets.test1;
const user1 = terra.wallets.test2;
const user2 = terra.wallets.test3;

let mirrorToken: string;
let terraswapPair: string;
let terraswapLpToken: string;

//----------------------------------------------------------------------------------------
// Setup
//----------------------------------------------------------------------------------------

async function setupTest() {
  // Step 1. Upload TerraSwap Token code
  process.stdout.write("Uploading TerraSwap Token code... ");

  const cw20CodeId = await storeCode(
    terra,
    deployer,
    path.resolve(__dirname, "../artifacts/terraswap_token.wasm")
  );

  console.log(chalk.green("Done!"), `${chalk.blue("codeId")}=${cw20CodeId}`);

  // Step 2. Instantiate TerraSwap Token contract
  process.stdout.write("Instantiating TerraSwap Token contract... ");

  const tokenResult = await instantiateContract(terra, deployer, deployer, cw20CodeId, {
    name: "Mock Mirror Token",
    symbol: "MIR",
    decimals: 6,
    initial_balances: [],
    mint: {
      minter: deployer.key.accAddress,
    },
  });

  mirrorToken = tokenResult.logs[0].events[0].attributes[3].value;

  console.log(chalk.green("Done!"), `${chalk.blue("contractAddress")}=${mirrorToken}`);

  // Step 3. Upload TerraSwap Pair code
  process.stdout.write("Uploading TerraSwap pair code... ");

  const codeId = await storeCode(
    terra,
    deployer,
    path.resolve(__dirname, "../artifacts/terraswap_pair.wasm")
  );

  console.log(chalk.green("Done!"), `${chalk.blue("codeId")}=${codeId}`);

  // Step 4. Instantiate TerraSwap Pair contract
  process.stdout.write("Instantiating TerraSwap pair contract... ");

  const pairResult = await instantiateContract(terra, deployer, deployer, codeId, {
    asset_infos: [
      {
        token: {
          contract_addr: mirrorToken,
        },
      },
      {
        native_token: {
          denom: "uusd",
        },
      },
    ],
    token_code_id: cw20CodeId,
  });

  const event = pairResult.logs[0].events.find((event) => {
    return event.type == "instantiate_contract";
  });

  terraswapPair = event?.attributes[3].value as string;
  terraswapLpToken = event?.attributes[7].value as string;

  console.log(
    chalk.green("Done!"),
    `${chalk.blue("terraswapPair")}=${terraswapPair}`,
    `${chalk.blue("terraswapLpToken")}=${terraswapLpToken}`
  );

  // Step 5. Mint tokens for use in testing
  process.stdout.write("Fund user 1 with MIR... ");

  await sendTransaction(terra, deployer, [
    new MsgExecuteContract(deployer.key.accAddress, mirrorToken, {
      mint: {
        recipient: user1.key.accAddress,
        amount: "10000000000",
      },
    }),
  ]);

  console.log(chalk.green("Done!"));

  process.stdout.write("Fund user 2 with MIR... ");

  await sendTransaction(terra, deployer, [
    new MsgExecuteContract(deployer.key.accAddress, mirrorToken, {
      mint: {
        recipient: user2.key.accAddress,
        amount: "10000000000",
      },
    }),
  ]);

  console.log(chalk.green("Done!"));
}

//----------------------------------------------------------------------------------------
// Test 1. Provide Initial Liquidity
//
// User 1 provides 69 MIR + 420 UST
// User 1 should receive sqrt(69000000 * 420000000) = 170235131 uLP
//
// Result
// ---
// pool uMIR  69000000
// pool uusd  420000000
// user uLP   170235131
//----------------------------------------------------------------------------------------

async function testProvideLiquidity() {
  process.stdout.write("Should provide liquidity... ");

  await sendTransaction(terra, user1, [
    new MsgExecuteContract(user1.key.accAddress, mirrorToken, {
      increase_allowance: {
        amount: "100000000",
        spender: terraswapPair,
      },
    }),
    new MsgExecuteContract(
      user1.key.accAddress,
      terraswapPair,
      {
        provide_liquidity: {
          assets: [
            {
              info: {
                token: {
                  contract_addr: mirrorToken,
                },
              },
              amount: "69000000",
            },
            {
              info: {
                native_token: {
                  denom: "uusd",
                },
              },
              amount: "420000000",
            },
          ],
        },
      },
      {
        uusd: "420000000",
      }
    ),
  ]);

  const poolUMir = await queryTokenBalance(terra, terraswapPair, mirrorToken);
  expect(poolUMir).to.equal("69000000");

  const poolUUsd = await queryNativeTokenBalance(terra, terraswapPair, "uusd");
  expect(poolUUsd).to.equal("420000000");

  const userULp = await queryTokenBalance(terra, user1.key.accAddress, terraswapLpToken);
  expect(userULp).to.equal("170235131");

  console.log(chalk.green("Passed!"));
}

//----------------------------------------------------------------------------------------
// Test 2. Swap
//
// User 2 sells 1 MIR for UST
//
// k = poolUMir * poolUUsd
// = 69000000 * 420000000 = 28980000000000000
// returnAmount = poolUusd - k / (poolUMir + offerUMir)
// = 420000000 - 28980000000000000 / (69000000 + 1000000)
// = 6000000
// fee = returnAmount * feeRate
// = 6000000 * 0.003
// = 18000
// returnAmountAfterFee = returnUstAmount - fee
// = 6000000 - 18000
// = 5982000
// returnAmountAfterFeeAndTax = deductTax(5982000) = 5976023
// transaction cost for pool = addTax(5976023) = 5981999
//
// Result
// ---
// pool uMIR  69000000 + 1000000 = 70000000
// pool uusd  420000000 - 5981999 = 414018001
// user uLP   170235131
// user uMIR  10000000000 - 1000000 = 9999000000
// user uusd  balanceBeforeSwap + 5976023 - 4500000 (gas)
//----------------------------------------------------------------------------------------

async function testSwap() {
  process.stdout.write("Should swap... ");

  const userUusdBefore = await queryNativeTokenBalance(
    terra,
    user2.key.accAddress,
    "uusd"
  );

  await sendTransaction(terra, user2, [
    new MsgExecuteContract(user2.key.accAddress, mirrorToken, {
      send: {
        amount: "1000000",
        contract: terraswapPair,
        msg: toEncodedBinary({
          swap: {},
        }),
      },
    }),
  ]);

  const poolUMir = await queryTokenBalance(terra, terraswapPair, mirrorToken);
  expect(poolUMir).to.equal("70000000");

  const poolUUsd = await queryNativeTokenBalance(terra, terraswapPair, "uusd");
  expect(poolUUsd).to.equal("414018001");

  const userULp = await queryTokenBalance(terra, user1.key.accAddress, terraswapLpToken);
  expect(userULp).to.equal("170235131");

  const userUMir = await queryTokenBalance(terra, user2.key.accAddress, mirrorToken);
  expect(userUMir).to.equal("9999000000");

  const userUusdExpected = new BN(userUusdBefore)
    .add(new BN("5976023"))
    .sub(new BN("4500000"))
    .toString();

  const userUUsd = await queryNativeTokenBalance(terra, user2.key.accAddress, "uusd");
  expect(userUUsd).to.equal(userUusdExpected);

  console.log(chalk.green("Passed!"));
}

//----------------------------------------------------------------------------------------
// Test 3. Slippage tolerance
//
// User 2 tries to swap a large amount of MIR (say 50 MIR, while the pool only has 70) to
// UST with a low max spread. The transaction should fail
//----------------------------------------------------------------------------------------

async function testSlippage() {
  process.stdout.write("Should check max spread... ");

  await expect(
    sendTransaction(terra, user2, [
      new MsgExecuteContract(user2.key.accAddress, mirrorToken, {
        send: {
          amount: "50000000",
          contract: terraswapPair,
          msg: toEncodedBinary({
            swap: {
              max_spread: "0.01",
            },
          }),
        },
      }),
    ])
  ).to.be.rejectedWith("Max spread assertion");

  console.log(chalk.green("Passed!"));
}

//----------------------------------------------------------------------------------------
// Main
//----------------------------------------------------------------------------------------

(async () => {
  console.log(chalk.yellow("\nStep 1. Info"));

  console.log(`Use ${chalk.cyan(deployer.key.accAddress)} as deployer`);
  console.log(`Use ${chalk.cyan(user1.key.accAddress)} as user 1`);
  console.log(`Use ${chalk.cyan(user2.key.accAddress)} as user 1`);

  console.log(chalk.yellow("\nStep 2. Setup"));

  await setupTest();

  console.log(chalk.yellow("\nStep 3. Tests"));

  await testProvideLiquidity();
  await testSwap();
  await testSlippage();

  console.log("");
})();
