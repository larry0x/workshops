![lets-validate](./lets-validate-1500x500.png)
<table>
<tbody>
  <tr>
    <td>event</td>
    <td>
      <a href="https://twitter.com/SparkIBC" target="_blank" rel="noopener noreferrer">SparkIBC</a>
    </td>
  </tr>
  <tr>
    <td>time</td>
    <td>June 25, 2022, 2:00 pm EST</td>
  </tr>
  <tr>
    <td>recording</td>
    <td>TBD</td>
  </tr>
</tbody>
</table>

# How to run a validator for Cosmos chains

In this workshop session, we will setup and validate a real blockchain using [simapp](https://github.com/cosmos/cosmos-sdk/tree/v0.45.4/simapp), a blockchain app included in the [Cosmos SDK repository](https://github.com/cosmos/cosmos-sdk) for education purpose.

We will cover the fundamentals that apply to every Cosmos chain; however, some chains also have their chain-specific requirements. E.g. [Terra](https://twitter.com/terra_money) requires validators also submit oracle feed; [Axelar](https://twitter.com/axelarcore) require validators run full nodes of several other blockchains. **Make sure to refer to the docs of the chain you want to validate for its chain-specific requirements.**

Use of hardware security modules (HSMs) or multi-party computing (MPC) signer programs such as [Horcrux](https://github.com/strangelove-ventures/horcrux) are recommended but out of the scope of this session.

## Prerequisites

Since our chain only has minimal functionalities and is absent any actual user traffic, its hardware requirement is quite low. Any potato computer would suffice for this workshop.

A _production-ready_ server for chains like Terra or Osmosis, however, typically requires:

- **8-core x86 CPU.** Cosmos apps do compile on ARM chips (e.g. Apple's M1 processor) but the reliabiliy is not battle-tested. Notably, chains that incorporate the [CosmWasm](https://cosmwasm.com/) module [won't even compile](https://github.com/CosmWasm/wasmvm#builds-of-libwasmvm) on ARM servers.
- **64 GB RAM.** Cosmos apps typically use less than 32 GB under normal conditions, but during events such as chain upgrades, up to 64 GB is usually needed.
- **4 TB NVME SSD.** _Hard drive I/O speed is crucial!_ Validators who run on HDD or SATA SSD often find themselves missing blocks. Requirement on disk space depends on the chain and your pruning settings (more on this later) but generally at least 2 TB is recommended. Ask your fellow validators what's their disk usage.
- **Linux operating system.** no windows allowed :)

See pic below for a build example, courtesy by [@gadikian](https://twitter.com/gadikian/status/1499927848928555008).

<image src="./gadikian-server.jpg" style="max-width: 500px;"/>

## Install stuff

After a fresh install of Ubuntu Server (or whichever Linux distro you use), create a user account (you don't want to use root) and give it `sudo` power:

```bash
useradd larry --create-home --shell /bin/bash
usermod larry -aG sudo
passwd larry
```

Login to your user account; install some essential packages:

```bash
sudo apt update
sudo apt upgrade
sudo apt install build-essential git vim jq libleveldb-dev
sudo apt autoremove
```

Install the Go programming language...

```bash
curl -LO https://golang.org/dl/go1.18.3.linux-amd64.tar.gz
tar xfz ./go1.18.3.linux-amd64.tar.gz
sudo mv go /usr/local
go version
```

...and configure related environment variables:

```bash
# ~/.bashrc
export GOROOT=/usr/local/go
export GOPATH=$HOME/.go
export GOBIN=$GOPATH/bin
export PATH=$PATH:$GOPATH/bin:$GOROOT/bin
```

## Compile the Cosmos app daemon

Download Cosmos SDK source code and checkout to the latest stable release, which in our case in `v0.45.5`:

```bash
git clone https://github.com/cosmos/cosmos-sdk.git
cd cosmos-sdk
git checkout v0.45.5
```

The command to compile the app is defined in `Makefile`. For most Cosmos apps it is `make install`, which will generate an executable in your `$GOBIN` folder. For simapp though, the command is `make build` which will produce an executable named `simd` (short for "sim daemon") under `./build`. We manually move this file to our `$GOBIN`:

```bash
make build
mkdir -p $GOBIN # create GOBIN folder if it does not already exist
mv ./build/simd $GOBIN
simd version
```

## Generate operator key

Each validator needs three private keys: **operator key**, **consensus key**. and **node key**. Let's first generate the operator key.

Run these commands to create a new private key named "validator":

```bash
# to generate a new seed phrase
simd keys add validator --coin-type 118
# to use an existing seed phrase
simd keys add validator --recover --coin-type 118

simd keys show validator
```

`--coin-type` is a parameter used when generating private keys from seed phrases, as defined in [SLIP-0044](https://github.com/satoshilabs/slips/blob/master/slip-0044.md). Most Cosmos chains use `118`, but some chains got creative and made their own coin type, such as Terra's `330`. For the sake of a better interchain UX, I recommand everyone use `118`, regardless of which chain you're on. [Let dogemos tell you why](https://www.youtube.com/watch?v=Qx95oqTW-6M&t=2903s)

## Initialize node

Run this command creates your consensus key, node key, as well as some config files for your node:

```bash
simd init yourmoniker --chain-id sim-1
```

Replace `yourmoniker` with any string your like. This is a name to identify your server. This is NOT your validator's moniker, which we will create later. It may be a good practice to not include any personally identifying info in this moniker for security reasons.

This command will generate a `.simapp` folder under your home directory:

```plain
~/.simapp
├─┬ config
│ ├── app.toml
│ ├── client.toml
│ ├── config.toml
│ ├── genesis.json
│ ├── node_key.json
│ ├── priv_validator_key.json
└─┬ data
  └── priv_validator_state.json
```

Let's walk over each file created.

* `config.toml` The config file for Tendermint. In case you don't already know, Cosmos chains use a modular/layered design, where on the bottom there is Tendermint, which handles networking, P2P connections, and consensus. On top of it are the SDK modules, which handle application logics such as accounts, token transfers, smart contracts and so on. `config.toml` is for the Tendermint part of the stack.
* `app.toml` This is the config for the SDK modules part of the stack.
* `client.toml` This is the config for the app's command line interface (CLI). For example, later on we will see we often have to specify parameters such as `--chain-id` when using CLI commands. You can set a default `--chain-id` in this file so you don't have to type the same thing in every command.
* `genesis.json` This is the genesis state of the blockchain. This file should contain crucial info needed for bootstrapping the chain such as initial token balance for each account, initial validator set, etc.
* `node_key.json` **Important❗ This is the node key.** This key is used in P2P connections for nodes to identify each other. Since it is not used in consensus, it is no biggie if lost, but still, it's recommended to back it up just in case.
* `priv_validator_key.json` **Important❗ This is the consensus key.** Your node use this key to sign blocks. **You should backup this file and don't show anyone else of its content.**
* `priv_validator_state.json` Without going into too much technicals, Tendermint uses this file to prevent your node from double-signing. For normal operations you don't have to worry about this file.

#### An important remainder

* BACKUP YOUR `priv_validator_key.json`
* BACKUP YOUR `priv_validator_key.json`
* BACKUP YOUR `priv_validator_key.json`

Look at [what happened to the Galatic Punks validator](https://twitter.com/galactic_punks/status/1509561588151427078) when they failed to so.

`node_key.json` is not that important, but let's back it up as well cuz why not.

## Configure node

Now let's delve into `config.toml` and `app.toml` and walk over some important config paramters you should be aware of.

Starting with `config.toml`:

```toml
proxy_app = "tcp://127.0.0.1:26658"

[rpc]
laddr = "tcp://127.0.0.1:26657"
pprof_laddr = "localhost:6060"

[p2p]
laddr = "tcp://0.0.0.0:26656"
```

Firstly, `simd` uses a number of ports for P2P communications. In general these do not need to be changed, but in case you are running multiple Cosmos chain nodes on the same server (common for IBC relayers), make sure to change the default settings, so that chain apps don't compete for the same ports:

```toml
priv_validator_laddr = ""
```

Unless you plan to use an external signing program such as [tmkms](https://github.com/tendermint/tmkms) or [horcrux](https://github.com/strangelove-ventures/horcrux/releases), this one can be left empty. If you do use such a program, Tendermint will use this port to communicate with the program. For example, Horcrux uses `tcp://0.0.0.0:1234` by default.

```toml
moniker = "yourmoniker"
```

This is the name of your server, used in P2P communications between Tendermint nodes. This is NOT your validator's name, which we will define later.

```toml
[p2p]
seeds = ""
persistent_peers = ""
```

In order to join the network, a node first needs to know a few peers to connect to. Seed node is a type of node that connects to a large number of peers, and when a new node joins the network, it informs the new node of available peers in the network. Typically the dev team will run at least one seed node.

Persistent peers are peers that you want to manually establish & maintain connection with. Typically you should only add a node as a persistent peer if you know & trust the person operates it. From time to time you may be contacted by arbitrageurs and MEV searchers requesting to establish persistent peers. Be very cautious in such cases!

Moving on to `app.toml`:

```toml
minimum-gas-prices = "0stake"
```

While Ethereum users discover gas prices by bidding in a fee market, in Cosmos each node defines a fixed "minimum gas prices". Upon receiving a tx from its peers, the node will add the tx to its mempool is the tx pays a fee higher than its minimum gas prices, or discard the tx if otherwise.

```toml
[api]
enable = true
swagger = false
address = "tcp://0.0.0.0:1317"

[rosetta]
enabled = false
address = ":8080"

[grpc]
enabled = false
address = "0.0.0.0:9090"

[grpc-web]
enabled = false
address = "0.0.0.0:9091"
```

Whether to enable the REST API, Rosetta, or gRPC endpoint, and the respective ports to use. Enable them if you do intend to use them, otherwise they can be left disabled.

NOTE: In order to use `--gas auto` when sending txs, one of API or gRPC must be abled. [The tx simulator is disabled if both API and gRPC are disabled.](https://github.com/cosmos/cosmos-sdk/issues/10081#issuecomment-1025668852)

## Create genesis state

> If you are joining an existing chain, the dev team should have made the `genesis.json` available for download. E.g. [here](https://github.com/terra-money/mainnet) for Terra and [here](https://github.com/osmosis-labs/networks) for Osmosis mainnets.
>
> If you are a participant of this workshop, you should email your validator pubkey and operator address to [larry](mailto:gm@larry.engineer) so that he can create the `genesis.json` and distribute it to participants. Get the file created by larry and overwrite your local `~/.simapp/config/genesis.json`.
>
> If you are larry, read below on how to create the genesis state...

First, for each genesis account:

```bash
simd add-genesis-account sim1... 123456stake  # specify the address and initial coin balance
```

This creates a record for the account in the auth module (which will verify txs signed by this account) and the bank module (which manages its coin balances). In this example we assign the account a balance of `123456stake`, where 123456 is the amount, and `stake` is the coin's denomination or "denom".

The network needs to have at least one genesis validator. To create a genesis validator:

```bash
simd gentx my-key-name 1000000stake \
  --chain-id sim-1 \
  --moniker myvalidator \
  --identity "..." \
  --details "..." \
  --security-contact "my@validator.com" \
  --website "https://my.validator.com" \
  --commission-rate 0.05 \
  --commission-max-rate 0.1 \
  --commission-max-change-rate 0.01
```

The flags of each flag will be discussed in a later section.

Once all accounts and validators have been registered:

```bash
simd collect-gentxs
```

This command collects all genesis data we have configured into a `genesis.json` file and deposits it into the `~/.simd/config` folder.

## Configure system service

As a node operator, you probably want your node software to run persistently in the system background. Linux distros each have their own way of managing background services, but most (e.g. Ubuntu and Arch) use the [`systemd`](https://en.wikipedia.org/wiki/Systemd) software.

To create a system service for `simd`, create a file as follows (you will need sudo privilege):

```bash
sudo vim /etc/systemd/system/simd.service
```

Enter the following, and save:

```
[Unit]
Description=Sim Daemon
After=network.target

[Service]
Type=simple
User=larry
ExecStart=/home/user/.go/bin/simd start
Restart=on-failure
RestartSec=5s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Replace the `simd` path in `ExecStart` with the actual path of your `simd` binary.

Two key points here are:

* By setting the `Restart` and `RestartSec` params, we instruct `systemd` to automatically restart the `simd` process in case it fails for some reason;
* With the `LimitNOFILE` param, we allow `simd` to access up to 65,535 files simultaneously. This is necessary because Cosmos nodes do need to access more files than what `systemd` allows by default.

Run the following command to register the system service:

```bash
sudo systemctl daemon-reload
```

If you want the node software to start automatically on each server reboot, run the following command to mark it as "enabled":

```bash
sudo systemctl enable simd
```

## Lfg!

Start your node with:

```bash
sudo systemctl start simd
```

The node software starts as a background service. To view its log:

```bash
journalctl -f -u simd --output cat
```

The `--output cat` flag allows for colored log outputs. I am not sure what it has to do with cats.

We need to wait for the node to sync up to the latest block. To check the node's sync status:

```bash
simd status 2>&1 | jq
```

`jq` formats the output into a more readable format. `2>&1` is necessary because of [a bug](https://twitter.com/wholesum/status/1481782663518113792) where Cosmos SDK mistakenly outputs the status to stderr instead or stdout.

The output should include the following data (only fields relevant to our discussions here are shown):

```json
{
  "NodeInfo": {
    "id": "e1f44e704271db4a18e48ffd24ae64361d2c51be", // derived from node_key.json
    "moniker": "yourmoniker",                         // defined in config.toml
  },
  "SyncInfo": {
    "latest_block_height": "4834328",
    "latest_block_time": "2022-06-21T12:31:40.747935942Z",
    "catching_up": false // important
  },
  "ValidatorInfo": {
    "Address": "...",    // derived from priv_validator_key.json
    "PubKey": { ... },   // same as above
    "VotingPower": "0"   // zero if the node is not a validator
  }
}
```

Your node is synced up if `SyncInfo.catching_up` is `false`.

Once synced up, register your node as a validator:

```bash
simd tx staking create-validator \
  --pubkey $(simd tendermint show-validator) \
  --moniker "the moniker for your validator" \
  --details "a description of your validator" \
  --identity "your keybase.io PGP key (block explorers will use your keybase pfp)" \
  --website "http://homepage.validator.com" \
  --security-contact "contact@your.email" \
  --min-self-delegation 1 \
  --commission-rate "0.05" \
  --commission-max-rate "0.20" \
  --commission-max-change-rate "0.01" \
  --amount 1000000stake \
  --from validator \
  --chain-id sim-1 \
  --gas auto \
  --gas-adjustment 1.4 \
  --gas-prices 0stake
```

A few notable flags:

* `pubkey`: By using the command `simd tendermint show-validator`, we provide the private key in `.simd/config/priv_validator_key.json` as your validator's signing key. Therefore, again, make sure to backup this file!!
* `moniker`: This is the moniker of your validator that will show up in wallet apps and block explorers
* `identity`: This is your [Keybase](https://keybase.io/) PGP key. It should be a 16-digit hex string; for example, mine is `28DC4101DA38C22C`. Most wallet apps and block explorers will use your Keybase profile picture as the your validator's pfp. The only exception is MintScan, for which you need to add your pfp to [this repo](https://github.com/cosmostation/cosmostation_token_resource) via a pull request (PR)
* `min-self-delegation`: The minimum amount of self delegation for your validator to be active. If you withdraw your self delegation to below this threshold, your validator will be immediately removed from the active set. Your validator will not be slashed, but will stop earning staking rewards. This is considered the proper way for a validator to voluntarily to cease operation. NOTE: If you intend to shut down, make sure to communicate with your delegators **at least 21 days** before withdrawing your self delegation, so that they have sufficient time to redelegate and not missing out on staking rewards.
* `commission-max-rate`: The maximum commission rate your validator is allowed to change. This number can not be changed. If you wish to go above this limit, you will have to create a new validator. This limit increases trust between you and your delegators, as they can be sure you will not rug them by ramping up your commission rate.
* `commission-max-change-rate`: Similar to the previous one, this parameter limits how quickly you can increase or decrease your commission rate.

Once the tx is confirmed, run the following query:

```bash
simd query staking validator $(simd keys show validator --bech val --address) --output json | jq
```

The output should look like:

```json
{
  "operator_address": "cosmosvaloper1...",
  "jailed": false,
  "status": "BOND_STATUS_BONDED",
  "tokens": "...",
  // ...
}
```

Your status should be "bonded"; if not ("unbonding" or "unbonded") the most likely reason is you do not have enough delegation to enter to active set.

If you're bonded, restart your node by:

```bash
sudo systemctl restart simd
```

You should see a log message that looks like:

```plain
INF This node is a validator addr=[...] module=consensus pubKey=[...]
```

This means your validator is now successfully registered and active!

Let's check whether your node is properly signing blocks:

```bash
simd query block | jq
```

This will display the latest block in JSON format. Scroll down to the `block.signatures` section, you should see an array of items in this format:

```json
{
  "block": {
    "signature": [
      {
        "block_id_flag": ...,
        "validator_address": "...",
        "timestamp": "...",
        "signature": "..."
      }
    ]
  }
}
```

Where `validator_address` is the validator's hex address. Your hex address can be found by running `simd status | jq`.

If your validator's signature shows up in the list, congrats 🎉🎉🎉 your validator has been successfully registered & is operating!

## Some tips & tricks

#### Use snapshot or state sync

Syncing up-to-date to an existing network may take time. Luckily, some validators like [ChainLayer](https://www.chainlayer.io/) are kind enough to share their **snapshots** with us. A snapshot is basically compressed pack of the `.simd/data` folder. To use the snapshot, go to [quicksync.io](https://quicksync.io/) and follow the instructions.

NOTE: You can use the pruned snapshot to bootstrap your node, even if you plan to use other pruning settings (e.g. "default" or "nothing").

State sync is another approach for quickly bootstrapping a new node, but I have not used it myself, so you guys have to figure out yourselves heehee

#### Jailed!

If your validator goes offline and misses too many blocks, it will be removed from the active set & "jailed". In this state, your delegations will be slowly slashed!! Check whether your validator is jailed using the `simd query staking validator` command which we have seen earlier.

If you still have enough delegations to enter the active set, simply run this command to unjail it:

```bash
simd tx slashing unjail --from validator
```

#### Edit your validator's info

From time to time you may want to rename your validator, change the description, etc. Do this by:

```bash
simd tx staking edit-validator \
  --moniker "the moniker for your validator" \
  --details "a description of your validator" \
  --identity "your keybase.io PGP key (block explorers will use your keybase pfp)" \
  --website "http://homepage.validator.com" \
  --security-contact "contact@your.email" \
  --from validator
```

A flag is only needed if it is to be changed (e.g. if you do not wish to change the security contact email, then it doesn't need to included in the command)

#### Withdraw commissions

Run the following command to claim your commissions:

```bash
simd tx distribution withdraw-rewards $(simd keys show validator --bech val --address) \
  --commission \
  --from validator
```

Note the `--commission` flag.

#### Migrating servers

To migrate your validator to a new server, you first sync up a new node (check the instruction on using snapshot or state sync). Then:

1. shut down your old node
2. copy your `priv_validator_key.json` and `priv_validator_state.json` to the new node
3. restart your new node; you should see the "This node is a validator" log message when starting up

NOTE: Step (1) must be done first, or your validator may double-sign!!!

Optional: Copy `node_key.json` to the new server as well. This is not mandatory, but helps your node to establish P2P connections faster.

## That's it!

Thanks for joining this workshop and have fun validating 😘
