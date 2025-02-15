// SPDX-License-Identifier: GPLv2

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// @author Wivern for Beefy.Finance, ToweringTopaz for Crystl.Finance
// @notice This contract adds liquidity to Uniswap V2 compatible liquidity pair pools and stake.

pragma solidity ^0.8.14;

import "./libraries/LibQuartz.sol";

contract QuartzUniV2Zap {
    using SafeERC20 for IERC20;
    using LibQuartz for IVaultHealer;
    using VaultChonk for IVaultHealer;

    uint256 public constant MINIMUM_AMOUNT = 1000;
    IVaultHealer public immutable vaultHealer;

    mapping(IERC20 => bool) private approvals;

    constructor(address _vaultHealer) {
        vaultHealer = IVaultHealer(_vaultHealer);
    }

    receive() external payable {
        require(Address.isContract(msg.sender));
    }

    function quartzInETH (uint vid, uint256 tokenAmountOutMin) external payable {
        require(msg.value >= MINIMUM_AMOUNT, 'Quartz: Insignificant input amount');
        
        IWETH weth = vaultHealer.getRouter(vid).WETH();
        
        weth.deposit{value: msg.value}();

        _swapAndStake(vid, tokenAmountOutMin, weth);
    }

    function estimateSwap(uint vid, IERC20 tokenIn, uint256 fullInvestmentIn) external view returns(uint256 swapAmountIn, uint256 swapAmountOut, IERC20 swapTokenOut) {
        return LibQuartz.estimateSwap(vaultHealer, vid, tokenIn, fullInvestmentIn);
    }

    function quartzIn (uint vid, uint256 tokenAmountOutMin, IERC20 tokenIn, uint256 tokenInAmount) external {
        uint allowance = tokenIn.allowance(msg.sender, address(this));
        uint balance = tokenIn.balanceOf(msg.sender);

        if (tokenInAmount == type(uint256).max) tokenInAmount = allowance < balance ? allowance : balance;
        else {
            require(allowance >= tokenInAmount, 'Quartz: Input token is not approved');
            require(balance >= tokenInAmount, 'Quartz: Input token has insufficient balance');
        }
        require(tokenInAmount >= MINIMUM_AMOUNT, 'Quartz: Insignificant input amount');
        
        tokenIn.safeTransferFrom(msg.sender, address(this), tokenInAmount);
        require(tokenIn.balanceOf(address(this)) >= tokenInAmount, 'Quartz: Fee-on-transfer/reflect tokens not yet supported');

        _swapAndStake(vid, tokenAmountOutMin, tokenIn);
    }

    //should only happen when this contract deposits as a maximizer
    function onERC1155Received(
        address operator, address /*from*/, uint256 /*id*/, uint256 /*amount*/, bytes calldata) external view returns (bytes4) {
        //if (msg.sender != address(vaultHealer)) revert("Quartz: Incorrect ERC1155 issuer");
        if (operator != address(this)) revert("Quartz: Improper ERC1155 transfer"); 
        return 0xf23a6e61;
    }

    function quartzOut (uint vid, uint256 withdrawAmount) public {
        (IUniRouter router,, IUniPair pair, bool isPair) = vaultHealer.getRouterAndPair(vid);
        if (withdrawAmount > 0) {
            uint[4] memory data = vaultHealer.tokenData(msg.sender, asSingletonArray(vid))[0];
            vaultHealer.safeTransferFrom(
                msg.sender, 
                address(this), 
                vid, 
                withdrawAmount > data[0] ? //user want tokens
                    data[1] : //user shares
                    withdrawAmount * data[3] / data[2], //amt * totalShares / wantLockedTotal
                ""
            );
        } else if (vaultHealer.balanceOf(address(this), vid) == 0) return;

        vaultHealer.withdraw(vid, type(uint).max, "");
        if (vid > 2**16) quartzOut(vid >> 16, 0);

        IWETH weth = router.WETH();

        if (isPair) {
            IERC20 token0 = pair.token0();
            IERC20 token1 = pair.token1();
            if (token0 != weth && token1 != weth) {
                LibQuartz.removeLiquidity(pair, msg.sender);
            } else {
                LibQuartz.removeLiquidity(pair, address(this));
                returnAsset(token0, weth); //returns any leftover tokens to user
                returnAsset(token1, weth); //returns any leftover tokens to user
            }
        } else {
            returnAsset(pair, weth);
        }
    }

    function _swapAndStake(uint vid, uint256 tokenAmountOutMin, IERC20 tokenIn) private {
        (IUniRouter router,,IUniPair pair, bool isPair) = vaultHealer.getRouterAndPair(vid);        
        
        IWETH weth = router.WETH();

        if (isPair) {
            IERC20 token0 = pair.token0();
            IERC20 token1 = pair.token1();

        //_approveTokenIfNeeded(tokenIn, router);

            if (token0 == tokenIn) {
                (uint256 reserveA, uint256 reserveB,) = pair.getReserves();
                LibQuartz.swapDirect(router, LibQuartz.getSwapAmount(router, tokenIn.balanceOf(address(this)), reserveA, reserveB), tokenIn, token1, tokenAmountOutMin);
            } else if (token1 == tokenIn) {
                (uint256 reserveA, uint256 reserveB,) = pair.getReserves();
                LibQuartz.swapDirect(router, LibQuartz.getSwapAmount(router, tokenIn.balanceOf(address(this)), reserveB, reserveA), tokenIn, token0, tokenAmountOutMin);
            } else {
                uint swapAmountIn = tokenIn.balanceOf(address(this))/2;
                
                if(LibQuartz.hasSufficientLiquidity(token0, tokenIn, router, MINIMUM_AMOUNT)) {
                    LibQuartz.swapDirect(router, swapAmountIn, tokenIn, token0, tokenAmountOutMin);
                } else {
                    LibQuartz.swapViaToken(router, swapAmountIn, tokenIn, weth, token0, tokenAmountOutMin);
                }
                
                if(LibQuartz.hasSufficientLiquidity(token1, tokenIn, router, MINIMUM_AMOUNT)) {
                    LibQuartz.swapDirect(router, swapAmountIn, tokenIn, token1, tokenAmountOutMin);
                } else {
                    LibQuartz.swapViaToken(router, swapAmountIn, tokenIn, weth, token1, tokenAmountOutMin);
                }

                returnAsset(tokenIn, weth);
            }
            
            LibQuartz.optimalMint(pair, token0, token1);
            returnAsset(token0, weth);
            returnAsset(token1, weth);
        } else {
            uint swapAmountIn = tokenIn.balanceOf(address(this));
            if(LibQuartz.hasSufficientLiquidity(pair, tokenIn, router, MINIMUM_AMOUNT)) {
                LibQuartz.swapDirect(router, swapAmountIn, tokenIn, pair, tokenAmountOutMin);
            } else {
                LibQuartz.swapViaToken(router, swapAmountIn, tokenIn, weth, pair, tokenAmountOutMin);
            }
            returnAsset(tokenIn, weth);
        }

        _approveTokenIfNeeded(pair);
        uint balance = pair.balanceOf(address(this));
        vaultHealer.deposit(vid, balance, "");
        
        balance = vaultHealer.balanceOf(address(this), vid);
        vaultHealer.safeTransferFrom(address(this), msg.sender, vid, balance, "");
    }


    function returnAsset(IERC20 token, IWETH weth) internal {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        
        if (token == weth) {
            weth.withdraw(balance);
            (bool success,) = msg.sender.call{value: address(this).balance}(new bytes(0));
            require(success, 'Quartz: ETH transfer failed');
        } else {
            token.safeTransfer(msg.sender, balance);
        }
    }

    function _approveTokenIfNeeded(IERC20 token) private {
        if (!approvals[token]) {
            token.safeApprove(address(vaultHealer), type(uint256).max);
            approvals[token] = true;
        }
    }

    function asSingletonArray(uint256 n) internal pure returns (uint256[] memory tempArray) {
        tempArray = new uint256[](1);
        tempArray[0] = n;
    }

    //This contract should not hold ERC20 tokens at the end of a transaction. If this happens due to some error, this will send the 
    //tokens to the treasury if it is set. Contact the team for help, and maybe they can return your missing token!
    function rescue(IERC20 token) external {
        (address receiver,) = vaultHealer.vaultFeeManager().getWithdrawFee(0);
        if (receiver == address(0)) receiver = msg.sender;
        token.transfer(receiver, token.balanceOf(address(this)));
    }

}