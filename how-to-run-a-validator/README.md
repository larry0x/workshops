![lets-validate](./lets-validate-1500x500.png)

# How to run a validator for Cosmos chains

In this workshop session, we will setup and validate a real blockchain using [simapp](https://github.com/cosmos/cosmos-sdk/tree/v0.45.4/simapp), a blockchain app included in the [Cosmos SDK repository]() for education purpose.

We will cover the fundamentals that apply to every Cosmos chain; however, some chains also have their chain-specific requirements. E.g. [Terra]() requires validators also submit oracle feed; [THORChain]() and [Axelar]() require validators run full nodes of several other blockchains. **Make sure to refer to the docs of the chain you want to validate for its chain-specific requirements.**

Use of hardware security modules (HSMs) or multi-party computing (MPC) signer programs such as [Horcrux]() are recommended but out of the scope of this session.

## Prerequisites

Since our chain only has minimal functionalities and is absent any actual user traffic, its hardware requirement is quite low. Any potato computer would suffice for this workshop.

A _production-ready_ server for chains like Terra or Osmosis, however, typically requires:

- **8-core x86 CPU.** Cosmos apps do compile on ARM chips (e.g. Apple's M1 processor) but the reliabiliy is not battle-tested. Notably, chains that incorporate the [CosmWasm]() module [won't even compile](https://github.com/CosmWasm/wasmvm#builds-of-libwasmvm) on ARM servers.
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
curl -LO https://golang.org/dl/go1.18.1.linux-amd64.tar.gz
tar xfz ./go1.18.1.linux-amd64.tar.gz
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

Download Cosmos SDK source code and checkout to the latest stable release, which in our case in `v0.45.4`:

```bash
git clone https://github.com/cosmos/cosmos-sdk.git
cd cosmos-sdk
git checkout v0.45.4
```

The command to compile the app is defined in `Makefile`. For most Cosmos apps it is `make install`, which will generate an executable in your `$GOBIN` folder. For simapp though, the command is `make build` which will produce an executable named `simd` (short for "sim daemon") under `./build`. We manually move this file to our `$GOBIN`:

```bash
make build
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
simd init yourmoniker
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

## Create genesis state

> If you are joining an existing chain, the dev team should have made the `genesis.json` available for download. E.g. [here]() for Terra and [here]() for Osmosis mainnets.
>
> If you are a participant of this workshop, you should email your validator pubkey and operator address to [larry](mailto:gm@larry.engineer) so that he can create the `genesis.json` and distribute it to participants. Get the file created by larry and overwrite your local `~/.simapp/config/genesis.json`.
>
> If you are larry, read below on how to create the genesis state...

## Configure system service

## Lfg!

## Some tips & tricks

#### Use snapshot or state sync

#### Monitor your validator's performance

#### Edit your validator's info

#### Withdraw commissions

#### Migrating servers

## That's it!

Thanks for joining this workshop and have fun validating 😘