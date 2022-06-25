# Workshop: How to do integration tests

<table>
<tbody>
  <tr>
    <td>event</td>
    <td>
      <a href="https://eventornado.com/event/terra-spacecamp#home" target="_blank" rel="noopener noreferrer">Terra Spacecamp 2021</a>
    </td>
  </tr>
  <tr>
    <td>time</td>
    <td>Aug 24 2021 7:00 pm EST</td>
  </tr>
  <tr>
    <td>livestream</td>
    <td>https://www.youtube.com/watch?v=hU5HWCL7WWc</td>
  </tr>
</tbody>
</table>

## Speaker

<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
  <img src="./larry.png" width="150" height="150"></img>
</a>

<table>
<tbody>
  <tr>
    <td>website</td>
    <td><a href="https://larry.engineer/" target="_blank" rel="noopener noreferrer">larry.engineer</a></td>
  </tr>
  <tr>
    <td>github</td>
    <td><a href="https://github.com/larry0x" target="_blank" rel="noopener noreferrer">@larry0x</a></td>
  </tr>
  <tr>
    <td>twitter</td>
    <td><a href="https://twitter.com/larry0x" target="_blank" rel="noopener noreferrer">@larry0x</a></td>
  </tr>
  <tr>
    <td>telegram</td>
    <td><a href="https://t.me/larry_0x" target="_blank" rel="noopener noreferrer">@larry_0x</a></td>
  </tr>
</tbody>
</table>

## Requirements

- Mac or Linux computer with x86 processors
- docker
- [rust-optimizer](https://github.com/CosmWasm/rust-optimizer)
- [LocalTerra](https://github.com/terra-money/LocalTerra)
- nodejs

Notes:

- **Windows users:** Sorry, but Windows is an inferior OS for software developement. I suggest upgrading to a Mac or install Linux on your PC (I used [arch](https://wiki.archlinux.org/title/installation_guide) btw)
- **M1 Mac users**: Sorry, LocalTerra doesn't run on ARM processors. There is currently no solution to this

## Procedures

### Spin up LocalTerra

```bash
git clone https://github.com/terra-money/LocalTerra.git
cd LocalTerra
git checkout v0.5.0  # important
```

Edit `LocalTerra/config/config.toml` as follows. This speeds up LocalTerra's blocktime which improves our productivity.

```diff
##### consensus configuration options #####
[consensus]

wal_file = "data/cs.wal/wal"
- timeout_propose = "3s"
- timeout_propose_delta = "500ms"
- timeout_prevote = "1s"
- timeout_prevote_delta = "500ms"
- timeout_precommit_delta = "500ms"
- timeout_commit = "5s"
+ timeout_propose = "200ms"
+ timeout_propose_delta = "200ms"
+ timeout_prevote = "200ms"
+ timeout_prevote_delta = "200ms"
+ timeout_precommit_delta = "200ms"
+ timeout_commit = "200ms"
```

Edit `LocalTerra/config/genesis.json` as follows. This fixes the stability fee ("tax") on Terra stablecoin transfers to a constant value (0.1%) so that our test transactions give reproducible results.

```diff
"app_state": {
  "treasury": {
    "params": {
      "tax_policy": {
-       "rate_min": "0.000500000000000000",
-       "rate_max": "0.010000000000000000",
+       "rate_min": "0.001000000000000000",
+       "rate_max": "0.001000000000000000",
      },
-     "change_rate_max": "0.000250000000000000"
+     "change_rate_max": "0.000000000000000000"
    }
  }
}
```

Once done, start LocalTerra by

```bash
docker compose up  # Ctrl + C to quit
```

From time to time, you may need to revert LocalTerra to its initial state. Do this by

```bash
docker compose rm
```

How to know if LocalTerra is working properly:

1. **Go to [https://localhost:1317/swagger/](http://localhost:1317/swagger/).** You should see a page with some APIs which can be used to send transactions or query blockchain state. However, we will be using [terra.js]() library to do this instead of from the swagger page
2. **Go to [this Terra Finder page](https://finder.terra.money/localterra/address/terra1x46rqay4d3cssq8gxxvqz8xt6nwlz4td20k38v).** Don't forget to select "LocalTerra" from the network selector on top right of the page. You should see an account with huge amounts of Luna and stablecoins. This is one of the accounts we will be using for the tests

### Compile contracts

```bash
# .zshrc or .bashrc

# set this to whichever latest version of the optimizer is
OPTIMIZER_VERSION="0.11.4"

alias rust-optimizer='docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/rust-optimizer:${OPTIMIZER_VERSION}'

alias workspace-optimizer='docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/code/target \
  --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
  cosmwasm/workspace-optimizer:${OPTIMIZER_VERSION}'
```

```bash
# in your project folder
rust-optimizer       # if your project contains only 1 contract
workspace-optimizer  # otherwise
```

### Run tests

```bash
git clone https://github.com/larry0x/spacecamp-2021-workshop.git
cd terra-spacecamp-2021-workshop/scripts
npm install
ts-node main.ts
```

## Acknowledgement

- Terraform Labs, Delphi Digital, Secret Network, and Confio for hosting this hackathon
- TerraSwap for the contract code

## License

The contents of this repository are open source under [MIT license](https://opensource.org/licenses/MIT)
