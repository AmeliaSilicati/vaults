// import hre from "hardhat";

const { tokens, accounts, routers } = require('../configs/addresses.js');
const { WMATIC, CRYSTL, DAI } = tokens.polygon;
const { FEE_ADDRESS, BURN_ADDRESS, ZERO_ADDRESS } = accounts.polygon;
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { IUniRouter02_abi } = require('./abi_files/IUniRouter02_abi.js');
const { token_abi } = require('./abi_files/token_abi.js');
const { IWETH_abi } = require('./abi_files/IWETH_abi.js');
const { IUniswapV2Pair_abi } = require('./abi_files/IUniswapV2Pair_abi.js');
const { boostPool_abi } = require('./abi_files/boostPool_abi.js');
const { getContractAddress } = require('@ethersproject/address')

//////////////////////////////////////////////////////////////////////////
// THESE FIVE VARIABLES BELOW NEED TO BE SET CORRECTLY FOR A GIVEN TEST //
//////////////////////////////////////////////////////////////////////////

const STRATEGY_CONTRACT_TYPE = 'Strategy'; //<-- change strategy type to the contract deployed for this strategy
const { dinoswapVaults } = require('../configs/dinoswapVaults'); //<-- replace all references to 'dinoswapVaults' (for example), with the right '...Vaults' name
const { crystlVault } = require('../configs/crystlVault'); //<-- replace all references to 'dinoswapVaults' (for example), with the right '...Vaults' name

const MASTERCHEF = dinoswapVaults[0].masterchef;
const VAULT_HEALER = dinoswapVaults[0].vaulthealer;
const WANT = dinoswapVaults[0].want;
const EARNED = dinoswapVaults[0].earned;
const PID = dinoswapVaults[0].PID;
const CRYSTL_ROUTER = routers.polygon.APESWAP_ROUTER;
const LP_AND_EARN_ROUTER = dinoswapVaults[0].router;

const EARNED_TOKEN_1 = EARNED[0]
const EARNED_TOKEN_2 = EARNED[1]
//const minBlocksBetweenSwaps = 100;

describe(`Testing ${STRATEGY_CONTRACT_TYPE} contract with the following variables:
    connected to vaultHealer @  ${VAULT_HEALER}
    depositing these LP tokens: ${WANT}
    into Masterchef:            ${MASTERCHEF} 
    with earned token:          ${EARNED_TOKEN_1}
    with earned2 token:         ${EARNED_TOKEN_2}
    `, () => {
    before(async () => {
        [user1, user2, user3, user4, _] = await ethers.getSigners();
		
		Magnetite = await ethers.getContractFactory("Magnetite");
		magnetite = await Magnetite.deploy();
        		
		Cavendish = await ethers.getContractFactory("Cavendish");
		cavendish = await Cavendish.deploy();
        //const from = user1.address;
        //const nonce = 1 + await user1.getTransactionCount();
		// vaultHealer = await getContractAddress({from, nonce});
		withdrawFee = ethers.BigNumber.from(10);
        earnFee = ethers.BigNumber.from(500);
        VaultHealer = await ethers.getContractFactory("VaultHealer");
        vaultHealer = await VaultHealer.deploy(user1.address, FEE_ADDRESS, withdrawFee, [ FEE_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS ], [earnFee, 0, 0]);

		vaultHealer.setVaultFeeManager(vaultFeeManager.address);

        vaultHealer.on("FailedEarn", (vid, reason) => {
			console.log("FailedEarn: ", vid, reason);
		});
		vaultHealer.on("FailedEarnBytes", (vid, reason) => {
			console.log("FailedEarnBytes: ", vid, reason);
		});
		
		//DINO to MATIC
		magnetite.overridePath(LP_AND_EARN_ROUTER, [ '0xaa9654becca45b5bdfa5ac646c939c62b527d394', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' ]);
		//DINO to WETH
		magnetite.overridePath(LP_AND_EARN_ROUTER, [ '0xaa9654becca45b5bdfa5ac646c939c62b527d394', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619' ]);

        //create the factory for the strategy implementation contract
        Strategy = await ethers.getContractFactory('Strategy');
        //deploy the strategy implementation contract
		strategyImplementation = await Strategy.deploy(vaultHealer.address);

        //create the factory for the tactics implementation contract
        Tactics = await ethers.getContractFactory("Tactics");
        //deploy the tactics contract for this specific type of strategy (e.g. masterchef, stakingRewards, or miniChef)
        tactics = await Tactics.deploy()
		let [tacticsA, tacticsB] = await tactics.generateTactics(
			dinoswapVaults[0]['masterchef'],
            dinoswapVaults[0]['PID'],
            0, //have to look at contract and see
            ethers.BigNumber.from("0x93f1a40b23000000"), //vaultSharesTotal - includes selector and encoded call format
            ethers.BigNumber.from("0xe2bbb15824000000"), //deposit - includes selector and encoded call format
            ethers.BigNumber.from("0x441a3e7024000000"), //withdraw - includes selector and encoded call format
            ethers.BigNumber.from("0x441a3e702f000000"), //harvest - includes selector and encoded call format
            ethers.BigNumber.from("0x5312ea8e20000000") //includes selector and encoded call format
        );

        //create factory and deploy strategyConfig contract
        StrategyConfig = await ethers.getContractFactory("StrategyConfig");
        strategyConfig = await StrategyConfig.deploy()

        DEPLOYMENT_DATA = await strategyConfig.generateConfig(
            tacticsA,
			tacticsB,
			dinoswapVaults[0]['want'],
			40,
			LP_AND_EARN_ROUTER,
			magnetite.address,
			240,
			false,
			dinoswapVaults[0]['earned'],
			[40]
		);

        LPtoken = await ethers.getContractAt(IUniswapV2Pair_abi, WANT);
        TOKEN0ADDRESS = await LPtoken.token0()
        TOKEN1ADDRESS = await LPtoken.token1()
        TOKEN_OTHER = CRYSTL;

        vaultHealerOwnerSigner = user1

		await vaultHealer.connect(vaultHealerOwnerSigner).createVault(strategyImplementation.address, DEPLOYMENT_DATA);
		strat1_pid = await vaultHealer.numVaultsBase();
		strat1 = await ethers.getContractAt('Strategy', await vaultHealer.strat(strat1_pid))
		
        //create the staking pool for the boosted vault
        BoostPoolImplementation = await ethers.getContractFactory("BoostPool", {});
        //need the wantToken address from the strategy!
		
        boostPoolImplementation = await BoostPoolImplementation.deploy(vaultHealer.address)
		abiCoder = new ethers.utils.AbiCoder()
		
		BOOST_POOL_DATA = abiCoder.encode(["address", "uint112", "uint32", "uint32"], [
		    "0x76bf0c28e604cc3fe9967c83b3c3f31c213cfe64", //reward token = crystl
            1000000, //is this in WEI? assume so...
            0,
            640515
		]);
		
		// boostID = strat1_pid
        returnArray = await vaultHealer.boostPoolVid(strat1_pid,0); //.toString();
        boostID = returnArray[0].toString();
        console.log("got here");
		boostPoolAddress = await vaultHealer.boostPool(boostID);
        console.log(boostPoolAddress);

        crystlRouter = await ethers.getContractAt(IUniRouter02_abi, CRYSTL_ROUTER);

        await crystlRouter.swapExactETHForTokens(0, [WMATIC, CRYSTL], boostPoolAddress, Date.now() + 900, { value: ethers.utils.parseEther("45") })

		await vaultHealer.createBoost(
		    strat1_pid,
			boostPoolImplementation.address,
			BOOST_POOL_DATA
		);
        boostPool = await ethers.getContractAt(boostPool_abi, boostPoolAddress);

        await network.provider.send("hardhat_setBalance", [
            user1.address,
            "0x21E19E0C9BAB240000000", //amount of 1000 in hex
        ]);

        await network.provider.send("hardhat_setBalance", [
            user2.address,
            "0x21E19E0C9BAB240000000", //amount of 1000 in hex
        ]);

        await network.provider.send("hardhat_setBalance", [
            user3.address,
            "0x21E19E0C9BAB240000000", //amount of 1000 in hex
        ]);

        await network.provider.send("hardhat_setBalance", [
            user4.address,
            "0x21E19E0C9BAB240000000", //amount of 1000 in hex
        ]);
	
        LPandEarnRouter = await ethers.getContractAt(IUniRouter02_abi, LP_AND_EARN_ROUTER);

        if (TOKEN0ADDRESS == ethers.utils.getAddress(WMATIC) ){
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN0ADDRESS); 
            await wmatic_token.deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.swapExactETHForTokens(0, [WMATIC, TOKEN0ADDRESS], user1.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }
        if (TOKEN1ADDRESS == ethers.utils.getAddress(WMATIC)) {
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN1ADDRESS); 
            await wmatic_token.deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.swapExactETHForTokens(0, [WMATIC, TOKEN1ADDRESS], user1.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }

        if (TOKEN0ADDRESS == ethers.utils.getAddress(WMATIC) ){
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN0ADDRESS); 
            await wmatic_token.connect(user2).deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.connect(user2).swapExactETHForTokens(0, [WMATIC, TOKEN0ADDRESS], user2.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }
        if (TOKEN1ADDRESS == ethers.utils.getAddress(WMATIC)) {
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN1ADDRESS); 
            await wmatic_token.connect(user2).deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.connect(user2).swapExactETHForTokens(0, [WMATIC, TOKEN1ADDRESS], user2.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }

        if (TOKEN0ADDRESS == ethers.utils.getAddress(WMATIC) ){
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN0ADDRESS); 
            await wmatic_token.connect(user3).deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.connect(user3).swapExactETHForTokens(0, [WMATIC, TOKEN0ADDRESS], user3.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }
        if (TOKEN1ADDRESS == ethers.utils.getAddress(WMATIC)) {
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN1ADDRESS); 
            await wmatic_token.connect(user3).deposit({ value: ethers.utils.parseEther("4500") });
        } else {
            await LPandEarnRouter.connect(user3).swapExactETHForTokens(0, [WMATIC, TOKEN1ADDRESS], user3.address, Date.now() + 900, { value: ethers.utils.parseEther("4500") })
        }

        if (TOKEN0ADDRESS == ethers.utils.getAddress(WMATIC) ){
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN0ADDRESS); 
            await wmatic_token.connect(user4).deposit({ value: ethers.utils.parseEther("3000") });
        } else {
            await LPandEarnRouter.connect(user4).swapExactETHForTokens(0, [WMATIC, TOKEN0ADDRESS], user4.address, Date.now() + 900, { value: ethers.utils.parseEther("3000") })
        }
        if (TOKEN1ADDRESS == ethers.utils.getAddress(WMATIC)) {
            wmatic_token = await ethers.getContractAt(IWETH_abi, TOKEN1ADDRESS); 
            await wmatic_token.connect(user4).deposit({ value: ethers.utils.parseEther("3000") });
        } else {
            await LPandEarnRouter.connect(user4).swapExactETHForTokens(0, [WMATIC, TOKEN1ADDRESS], user4.address, Date.now() + 900, { value: ethers.utils.parseEther("3000") })
        }
		

        await crystlRouter.connect(user4).swapExactETHForTokens(0, [WMATIC, TOKEN_OTHER], user4.address, Date.now() + 900, { value: ethers.utils.parseEther("3000") })


        //create instances of token0 and token1
        token0 = await ethers.getContractAt(token_abi, TOKEN0ADDRESS);
        token1 = await ethers.getContractAt(token_abi, TOKEN1ADDRESS);
        
        //user 1 adds liquidity to get LP tokens
        var token0BalanceUser1 = await token0.balanceOf(user1.address);
        await token0.approve(LPandEarnRouter.address, token0BalanceUser1);
		
        var token1BalanceUser1 = await token1.balanceOf(user1.address);
        await token1.approve(LPandEarnRouter.address, token1BalanceUser1);
		
        await LPandEarnRouter.addLiquidity(TOKEN0ADDRESS, TOKEN1ADDRESS, token0BalanceUser1, token1BalanceUser1, 0, 0, user1.address, Date.now() + 900)

        //user 2 adds liquidity to get LP tokens
        var token0BalanceUser2 = await token0.balanceOf(user2.address);
        await token0.connect(user2).approve(LPandEarnRouter.address, token0BalanceUser2);
        
        var token1BalanceUser2 = await token1.balanceOf(user2.address);
        await token1.connect(user2).approve(LPandEarnRouter.address, token1BalanceUser2);

        await LPandEarnRouter.connect(user2).addLiquidity(TOKEN0ADDRESS, TOKEN1ADDRESS, token0BalanceUser2, token1BalanceUser2, 0, 0, user2.address, Date.now() + 900)
        
        //user 3 adds liquidity to get LP tokens
        var token0BalanceUser3 = await token0.balanceOf(user3.address);
        await token0.connect(user3).approve(LPandEarnRouter.address, token0BalanceUser3);
        
        var token1BalanceUser3 = await token1.balanceOf(user3.address);
        await token1.connect(user3).approve(LPandEarnRouter.address, token1BalanceUser3);

        await LPandEarnRouter.connect(user3).addLiquidity(TOKEN0ADDRESS, TOKEN1ADDRESS, token0BalanceUser3, token1BalanceUser3, 0, 0, user3.address, Date.now() + 900)
        
        tokenOther = await ethers.getContractAt(token_abi, TOKEN_OTHER);

    });

    describe(`Testing depositing into vault, compounding vault, withdrawing from vault:
    `, () => {
        // Stake a round number of LPs (e.g., 1 or 0.0001) - not a round number yet!
        it('Should deposit user1\'s 100 LP tokens into the vault, increasing vaultSharesTotal by the correct amount', async () => {
            // initialLPtokenBalance = await LPtoken.balanceOf(user1.address);
            user1InitialDeposit = await LPtoken.balanceOf(user1.address); //ethers.utils.parseEther("5000");

            await LPtoken.connect(user1).approve(vaultHealer.address, user1InitialDeposit);
            LPtokenBalanceBeforeFirstDeposit = await LPtoken.balanceOf(user1.address);
            await vaultHealer.connect(user1)["deposit(uint256,uint256,bytes)"](strat1_pid, user1InitialDeposit, []);
            const vaultSharesTotalAfterFirstDeposit = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal() //=0
            console.log(`User1 deposits ${ethers.utils.formatEther(user1InitialDeposit)} LP tokens`)
            console.log(`Vault Shares Total went up by ${ethers.utils.formatEther(vaultSharesTotalAfterFirstDeposit)} LP tokens`)

            expect(user1InitialDeposit).to.equal(vaultSharesTotalAfterFirstDeposit);
        })
        
        it('Should mint ERC1155 tokens for this user, with the strat1_pid of the strategy and equal to LP tokens deposited', async () => {
            userBalanceOfStrategyTokens = await vaultHealer.balanceOf(user1.address, strat1_pid);
            console.log(`User1 balance of ERC1155 tokens is now ${ethers.utils.formatEther(userBalanceOfStrategyTokens)} tokens`)
            // console.log(await vaultHealer.userTotals(strat1_pid, user1.address));
            expect(userBalanceOfStrategyTokens).to.eq(user1InitialDeposit); 
        })

        it('Should allow user to boost via enableBoost, showing a balanceOf in the pool afterwards', async () => {
            userBalanceOfStrategyTokensBeforeStaking = await vaultHealer.balanceOf(user1.address, strat1_pid);
            
            for (i=0; i<10;i++) { //minBlocksBetweenSwaps - can use this variable as an alternate to hardcoding a value
                await ethers.provider.send("evm_mine"); //creates a delay of 100 blocks - could adjust this to be minBlocksBetweenSwaps+1 blocks
            }
            await vaultHealer.connect(user1)["enableBoost(uint256)"](boostID);

            user = await boostPool.userInfo(user1.address);
            userBalanceOfBoostPool = user.amount;
            expect(userBalanceOfBoostPool).to.equal(userBalanceOfStrategyTokensBeforeStaking);
        })

        it('Should accumulate rewards for the staked user over time', async () => {
            userRewardDebtAtStart = await boostPool.pendingReward(user1.address);
            console.log("userRewardDebtAtStart: ", ethers.utils.formatEther(userRewardDebtAtStart));
            for (i=0; i<1000;i++) { //minBlocksBetweenSwaps
                await ethers.provider.send("evm_mine"); //creates a delay of minBlocksBetweenSwaps+1 blocks
                }
            
            userRewardDebtAfterTime = await boostPool.pendingReward(user1.address);;
            console.log("userRewardDebtAfterTime: ", ethers.utils.formatEther(userRewardDebtAfterTime));
            expect(userRewardDebtAfterTime).to.be.gt(userRewardDebtAtStart); //will only be true on first deposit?
        })

        it('Should allow the user to harvest their boost pool rewards', async () => {
            crystlToken = await ethers.getContractAt(token_abi, CRYSTL);
            userRewardTokenBalanceBeforeWithdrawal = await crystlToken.balanceOf(user1.address);
            console.log("userRewardTokenBalanceBeforeWithdrawal", ethers.utils.formatEther(userRewardTokenBalanceBeforeWithdrawal));

            await vaultHealer.connect(user1)["harvestBoost(uint256)"](boostID);
            
            userRewardTokenBalanceAfterWithdrawal = await crystlToken.balanceOf(user1.address);
            console.log("userRewardTokenBalanceAfterWithdrawal", ethers.utils.formatEther(userRewardTokenBalanceAfterWithdrawal));
            expect(userRewardTokenBalanceAfterWithdrawal.sub(userRewardTokenBalanceBeforeWithdrawal)).to.be.gt(0); //eq(userRewardDebtAfterTime.add(1000000)); //adding one extra block of reward - this right?

        })

        //check that reward got returned to user1 on withdrawal

        // it('should return reward to user upon unstaking', async () => {
        //     // userRewardDebtBeforeWithdrawal = await boostPool.pendingReward(user1.address);
        //     crystlToken = await ethers.getContractAt(token_abi, CRYSTL);
        //     userRewardTokenBalanceAfterWithdrawal = await crystlToken.balanceOf(user1.address);
        //     expect(userRewardTokenBalanceAfterWithdrawal).to.eq(userRewardDebtAfterTime);
        // })

        // Compound LPs (Call the earn function with this specific farm’s strat1_pid).
        // Check balance to ensure it increased as expected
        it('Should wait 10 blocks, then compound the LPs by calling earn(), so that vaultSharesTotal is greater after than before', async () => {
            const vaultSharesTotalBeforeCallingEarnSome = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal()
            maticToken = await ethers.getContractAt(token_abi, WMATIC);

            balanceMaticAtFeeAddressBeforeEarn = await ethers.provider.getBalance(FEE_ADDRESS); //note: MATIC, not WMATIC

            // console.log(`Block number before calling earn ${await ethers.provider.getBlockNumber()}`)
            // console.log(`vaultSharesTotalBeforeCallingEarnSome: ${vaultSharesTotalBeforeCallingEarnSome}`)

            for (i=0; i<100;i++) { //minBlocksBetweenSwaps - can use this variable as an alternate to hardcoding a value
                await ethers.provider.send("evm_mine"); //creates a delay of 100 blocks - could adjust this to be minBlocksBetweenSwaps+1 blocks
            }

            await vaultHealer["earn(uint256[])"]([strat1_pid]);
            // console.log(`Block number after calling earn ${await ethers.provider.getBlockNumber()}`)

            vaultSharesTotalAfterCallingEarnSome = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal()
            // console.log(`vaultSharesTotalAfterCallingEarnSome: ${vaultSharesTotalAfterCallingEarnSome}`)

            const differenceInVaultSharesTotal = vaultSharesTotalAfterCallingEarnSome.sub(vaultSharesTotalBeforeCallingEarnSome);

            expect(differenceInVaultSharesTotal).to.be.gt(0); //.toNumber()
        }) 

        it('Should pay 5% of earnedAmt to the feeAddress with each earn, in WMATIC', async () => {
            balanceMaticAtFeeAddressAfterEarn = await ethers.provider.getBalance(FEE_ADDRESS); //note: MATIC, not WMATIC
            expect(balanceMaticAtFeeAddressAfterEarn).to.be.gt(balanceMaticAtFeeAddressBeforeEarn);
        })
        
        // Unstake 50% of LPs. 
        // Check transaction to ensure withdraw fee amount is as expected and amount withdrawn in as expected
        it('Should withdraw 50% of LPs with correct withdraw fee amount (0.1%) and decrease users stakedWantTokens balance correctly', async () => {
            await vaultHealer["earn(uint256[])"]([strat1_pid]);
            const LPtokenBalanceBeforeFirstWithdrawal = await LPtoken.balanceOf(user1.address);
            const UsersStakedTokensBeforeFirstWithdrawal = await vaultHealer.balanceOf(user1.address, strat1_pid);
            console.log(ethers.utils.formatEther(LPtokenBalanceBeforeFirstWithdrawal));
            console.log(ethers.utils.formatEther(UsersStakedTokensBeforeFirstWithdrawal));

            vaultSharesTotalInMaximizerBeforeWithdraw = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal()
            console.log(ethers.utils.formatEther(vaultSharesTotalInMaximizerBeforeWithdraw));

            crystlToken = await ethers.getContractAt(token_abi, CRYSTL);
            user1CrystlBalanceBeforeWithdraw = await crystlToken.balanceOf(user1.address);

            console.log(`User 1 withdraws ${ethers.utils.formatEther(UsersStakedTokensBeforeFirstWithdrawal.div(2))} LP tokens from the vault`)

            await vaultHealer["withdraw(uint256,uint256,bytes)"](strat1_pid, UsersStakedTokensBeforeFirstWithdrawal.div(2), []); 
            
            const LPtokenBalanceAfterFirstWithdrawal = await LPtoken.balanceOf(user1.address);
            console.log(ethers.utils.formatEther(LPtokenBalanceAfterFirstWithdrawal));

            // vaultSharesTotalAfterFirstWithdrawal = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal() 
            const UsersStakedTokensAfterFirstWithdrawal = await vaultHealer.balanceOf(user1.address, strat1_pid);

            // console.log(ethers.utils.formatEther(vaultSharesTotalInMaximizerBeforeWithdraw));
            // console.log(ethers.utils.formatEther(vaultSharesTotalAfterFirstWithdrawal));
            console.log(`We now have ${ethers.utils.formatEther(UsersStakedTokensAfterFirstWithdrawal)} total LP tokens left in the vault`)
            // console.log(await vaultHealer.userTotals(strat1_pid, user1.address));

            expect(LPtokenBalanceAfterFirstWithdrawal.sub(LPtokenBalanceBeforeFirstWithdrawal))
            .to.equal(
                (UsersStakedTokensBeforeFirstWithdrawal.div(2))
                    .sub(withdrawFee
                    .mul(UsersStakedTokensBeforeFirstWithdrawal.div(2))
                    .div(10000))
                )
                ;
        })

                // Stake a round number of LPs (e.g., 1 or 0.0001) - not a round number yet!
        it('Should deposit all of user2\'s LP tokens into the vault, increasing users stakedWantTokens by the correct amount', async () => {
            // const LPtokenBalanceOfUser2BeforeFirstDeposit = await LPtoken.balanceOf(user2.address);
            await vaultHealer["earn(uint256[])"]([strat1_pid]);
            user2InitialDeposit = await LPtoken.balanceOf(user2.address); //ethers.utils.parseEther("1500");
            const vaultSharesTotalBeforeUser2FirstDeposit = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal() //=0
            console.log(`VaultSharesTotal is ${ethers.utils.formatEther(vaultSharesTotalBeforeUser2FirstDeposit)} LP tokens before user 2 deposits`)

            await LPtoken.connect(user2).approve(vaultHealer.address, user2InitialDeposit); //no, I have to approve the vaulthealer surely?
            // console.log("lp token approved by user 2")
            await vaultHealer.connect(user2)["deposit(uint256,uint256,bytes)"](strat1_pid, user2InitialDeposit, []);
            const vaultSharesTotalAfterUser2FirstDeposit = await strat1.connect(vaultHealerOwnerSigner).vaultSharesTotal() //=0
            const User2sSharesAfterFirstDeposit = await vaultHealer.balanceOf(user2.address, strat1_pid)
            const totalSharesAfterUser2FirstDeposit = await vaultHealer.totalSupply(strat1_pid);
            
            User2sStakedTokensAfterFirstDeposit = User2sSharesAfterFirstDeposit.mul(vaultSharesTotalAfterUser2FirstDeposit).div(totalSharesAfterUser2FirstDeposit)
            console.log(`User2 has ${ethers.utils.formatEther(User2sStakedTokensAfterFirstDeposit)} after making their first deposit`)

            console.log(`User 2 deposits ${ethers.utils.formatEther(user2InitialDeposit)} LP tokens`)
            console.log(`VaultSharesTotal is ${ethers.utils.formatEther(vaultSharesTotalAfterUser2FirstDeposit)} LP tokens after user 2 deposits`)

            expect(user2InitialDeposit).to.equal(User2sStakedTokensAfterFirstDeposit) //.sub(vaultSharesTotalBeforeUser2FirstDeposit)); //will this work for 2nd deposit? on normal masterchef?
        })

        // Deposit 100% of users LP tokens into vault, ensure balance increases as expected.
        it('Should accurately increase users shares upon second deposit by user1', async () => {
            const LPtokenBalanceBeforeSecondDeposit = await LPtoken.balanceOf(user1.address);
            await LPtoken.approve(vaultHealer.address, LPtokenBalanceBeforeSecondDeposit);
            const User1sStakedTokensBeforeSecondDeposit = await vaultHealer.balanceOf(user1.address, strat1_pid);

            await vaultHealer["deposit(uint256,uint256,bytes)"](strat1_pid, LPtokenBalanceBeforeSecondDeposit, []); //user1 (default signer) deposits LP tokens into specified strat1_pid vaulthealer
            
            const LPtokenBalanceAfterSecondDeposit = await LPtoken.balanceOf(user1.address);
            const User1sStakedTokensAfterSecondDeposit = await vaultHealer.balanceOf(user1.address, strat1_pid);

            expect(LPtokenBalanceBeforeSecondDeposit.sub(LPtokenBalanceAfterSecondDeposit)).to.closeTo(User1sStakedTokensAfterSecondDeposit.sub(User1sStakedTokensBeforeSecondDeposit), ethers.BigNumber.from(1000000000000000)); //will this work for 2nd deposit? on normal masterchef?
        })
        

        // Withdraw 100%
        it('Should withdraw remaining user1 balance back to user1, with all of it staked in boosting pool, minus withdrawal fee (0.1%)', async () => {
            await vaultHealer["earn(uint256[])"]([strat1_pid]);
            userBalanceOfStrategyTokensBeforeStaking = await vaultHealer.balanceOf(user1.address, strat1_pid);

            //Should not use approval in this manner ever
            //await vaultHealer.connect(user1).setApprovalForAll(boostPool.address, true); //dangerous to approve all forever?

            //await vaultHealer.connect(user1)["enableBoost(uint256,uint256)"](strat1_pid, 0);
            user = await boostPool.userInfo(user1.address);
            userBalanceOfBoostPool = user.amount;

            wantTokensBeforeWithdrawal = await strat1.wantLockedTotal();
            const LPtokenBalanceBeforeFinalWithdrawal = await LPtoken.balanceOf(user1.address)
            
            userRewardTokenBalanceBeforeFinalWithdrawal = await crystlToken.balanceOf(user1.address);
            console.log("userRewardTokenBalanceBeforeFinalWithdrawal", ethers.utils.formatEther(userRewardTokenBalanceBeforeFinalWithdrawal));

            console.log("LPtokenBalanceBeforeFinalWithdrawal - user1")
            console.log(ethers.utils.formatEther(LPtokenBalanceBeforeFinalWithdrawal))

            const UsersStakedTokensBeforeFinalWithdrawal = await vaultHealer.balanceOf(user1.address, strat1_pid);
            console.log("UsersStakedTokensBeforeFinalWithdrawal - user1")
            console.log(ethers.utils.formatEther(UsersStakedTokensBeforeFinalWithdrawal))
            // userBoostedWantTokensBeforeWithdrawal = await vaultHealer.balanceOf(user1.address, strat1_pid);
            // console.log("userBoostedWantTokensBeforeWithdrawal");
            // console.log(ethers.utils.formatEther(userBoostedWantTokensBeforeWithdrawal));


            await vaultHealer["withdraw(uint256,uint256,bytes)"](strat1_pid, ethers.constants.MaxUint256, []); 
			//+userBoostedWantTokensBeforeWithdrawal user1 (default signer) deposits 1 of LP tokens into strat1_pid 0 of vaulthealer
            
            const LPtokenBalanceAfterFinalWithdrawal = await LPtoken.balanceOf(user1.address);
            console.log("LPtokenBalanceAfterFinalWithdrawal - user1")
            console.log(ethers.utils.formatEther(LPtokenBalanceAfterFinalWithdrawal))

            wantTokensAfterWithdrawal = await strat1.wantLockedTotal();
            
            userStakedWantTokensAfterWithdrawal = await vaultHealer.balanceOf(user1.address, strat1_pid); //todo change to boosted tokens??

            userRewardTokenBalanceAfterFinalWithdrawal = await crystlToken.balanceOf(user1.address);
            console.log("userRewardTokenBalanceAfterFinalWithdrawal", ethers.utils.formatEther(userRewardTokenBalanceAfterFinalWithdrawal));

            expect(LPtokenBalanceAfterFinalWithdrawal.sub(LPtokenBalanceBeforeFinalWithdrawal))
            .to.closeTo(
                (wantTokensBeforeWithdrawal.sub(wantTokensAfterWithdrawal)) //.add(userBoostedWantTokensBeforeWithdrawal).sub(userBoostedWantTokensAfterWithdrawal))
                .sub(
                    (withdrawFee)
                    .mul(wantTokensBeforeWithdrawal.sub(wantTokensAfterWithdrawal)) //.add(userBoostedWantTokensBeforeWithdrawal).sub(userBoostedWantTokensAfterWithdrawal))
                    .div(10000),
                ),
				ethers.BigNumber.from(1000000000000000)
                );
        })

        //ensure no funds left in the vault.
        it('Should leave zero user1 funds in vault after 100% withdrawal', async () => {
            // console.log(await crystlToken.balanceOf(strat1.address))
            expect(userStakedWantTokensAfterWithdrawal).to.equal(0);
        })

        it('Should leave zero user1 funds in boostPool after 100% withdrawal', async () => {
            // console.log(await crystlToken.balanceOf(strat1.address))
            user = await boostPool.userInfo(user1.address);
            userBalanceOfBoostPoolAtEnd = user.amount;
            expect(userBalanceOfBoostPoolAtEnd).to.equal(0);
        })
        
    })
})

