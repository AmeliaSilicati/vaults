// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.14;

import "./VaultHealerBase.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ERC1155.sol";

abstract contract VaultHealerGate is VaultHealerBase, ERC1155 {
    using SafeERC20 for IERC20;

    struct PendingDeposit {
        IERC20 token;
        uint96 amount0;
        address from;
        uint96 amount1;
    }
    mapping(address => mapping(uint256 => uint256)) public maximizerEarningsOffset;
    mapping(uint256 => uint256) public totalSupply;
    mapping(uint256 => uint256) public totalMaximizerEarnings;

    mapping(address => PendingDeposit) private pendingDeposits;

    //For front-end and general purpose external compounding. Returned amounts are zero on failure, or the gas cost on success
    function earn(uint256[] calldata vids) external nonReentrant returns (uint[] memory successGas) {
        Fee.Data[3][] memory fees = vaultFeeManager.getEarnFees(vids);
        uint len = vids.length;

        successGas = new uint[](len);
        for (uint i; i < len; i++) {
            uint gasBefore = gasleft();
            if (_earn(vids[i], fees[i], msg.data[0:0])) successGas[i] = gasBefore - gasleft();
        }
    }

    function earn(uint256[] calldata vids, bytes[] calldata data) external nonReentrant returns (uint[] memory successGas) {
        uint len = vids.length;
        if (data.length != len) revert ArrayMismatch(len, data.length);
        Fee.Data[3][] memory fees = vaultFeeManager.getEarnFees(vids);
        
        successGas = new uint[](len);
        for (uint i; i < len; i++) {
            uint gasBefore = gasleft();
            if (_earn(vids[i], fees[i], data[i])) successGas[i] = gasBefore - gasleft();
        }
    }

    function _earn(uint256 vid, Fee.Data[3] memory fees, bytes calldata data) internal returns (bool) {
        VaultInfo storage vault = vaultInfo[vid];
        if (paused(vid) || vault.lastEarnBlock == block.number) return false;

        vault.lastEarnBlock = uint48(block.number);
        try strat(vid).earn(fees, msg.sender, data) returns (bool success, uint256 wantLockedTotal) {
            if (success) {                
                emit Earned(vid, wantLockedTotal, totalSupply[vid]);
                return true;
            }
        } catch Error(string memory reason) {
            emit FailedEarn(vid, reason);
        } catch (bytes memory reason) {
            emit FailedEarnBytes(vid, reason);
        }
        return false;
    }
    
    //Allows maximizers to make reentrant calls, only to deposit to their target
    function maximizerDeposit(uint _vid, uint _wantAmt, bytes calldata _data) external payable whenNotPaused(_vid) {
        require(address(strat(_vid)) == msg.sender, "VH: sender does not match vid");
        totalMaximizerEarnings[_vid] += _deposit(_vid >> 16, _wantAmt, _data);
    }

    // Want tokens moved from user -> this -> Strat (compounding
    function deposit(uint256 _vid, uint256 _wantAmt, bytes calldata _data) external payable whenNotPaused(_vid) nonReentrant {
        IERC20 token = vaultInfo[_vid].want;
        uint balance = token.balanceOf(msg.sender);
        if (balance < _wantAmt) revert InsufficientBalance(token, msg.sender, balance, _wantAmt);
        uint approval = token.allowance(msg.sender, address(this));
        if (approval < _wantAmt) revert InsufficientApproval(token, msg.sender, approval, _wantAmt);

        _deposit(_vid, _wantAmt, _data);
    }

    function _deposit(uint256 _vid, uint256 _wantAmt, bytes calldata _data) private returns (uint256 vidSharesAdded) {
        uint totalSupplyBefore = totalSupply[_vid];
        // If enabled, we call an earn on the vault before we action the _deposit
        if (totalSupplyBefore > 0 && vaultInfo[_vid].noAutoEarn & 1 == 0) _earn(_vid, vaultFeeManager.getEarnFees(_vid), _data); 

        //Store the _from address, deposit amount, and ERC20 token associated with this vault. The strategy will be able to withdraw from _from via 
        //VaultHealer's approval, but no more than _wantAmt. This allows VaultHealer to be the only vault contract where token approvals are needed. 
        //Users can be approve VaultHealer freely and be assured that VaultHealer will not withdraw anything except when they call deposit, and only
        //up to the correct deposit amount.
        IERC20 vaultWant = vaultInfo[_vid].want;
        if (_wantAmt > 0 && address(vaultWant) != address(0)) pendingDeposits[address(strat(_vid))] = PendingDeposit({
            token: vaultWant,
            amount0: uint96(_wantAmt >> 96),
            from: msg.sender,
            amount1: uint96(_wantAmt)
        });

        // we make the deposit
        (_wantAmt, vidSharesAdded) = strat(_vid).deposit{value: msg.value}(_wantAmt, totalSupplyBefore, abi.encode(msg.sender, msg.sender, msg.sender, _data));

        //we mint tokens for the user via the 1155 contract
        _mint(
            msg.sender,
            _vid, //use the vid of the strategy 
            vidSharesAdded,
            _data
        );

        delete pendingDeposits[address(strat(_vid))]; //In case the pending deposit was not used, don't store it

        emit Deposit(msg.sender, _vid, _wantAmt);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _vid, uint256 _wantAmt, bytes calldata _data) external nonReentrant {
        _withdraw(_vid, _wantAmt, msg.sender, _data);
    }

    function withdraw(uint256 _vid, uint256 _wantAmt, address _to, bytes calldata _data) external nonReentrant {
        _withdraw(_vid, _wantAmt, _to, _data);
    }

    function _withdraw(uint256 _vid, uint256 _wantAmt, address _to, bytes calldata _data) private returns (uint256 vidSharesRemoved) {
		uint fromBalance = balanceOf(msg.sender, _vid);
        if (fromBalance == 0) revert WithdrawZeroBalance(msg.sender);

        // we call an earn on the vault before we action the _deposit
        if (vaultInfo[_vid].noAutoEarn & 2 == 0) _earn(_vid, vaultFeeManager.getEarnFees(_vid), _data); 

        (vidSharesRemoved, _wantAmt) = strat(_vid).withdraw(_wantAmt, fromBalance, totalSupply[_vid], abi.encode(msg.sender, msg.sender, _to, _data));
		
        //burn the tokens equal to vidSharesRemoved
        _burn(
            msg.sender,
            _vid,
            vidSharesRemoved
        );
		
        //Collect the withdrawal fee and transfer the ERC20 token out
        IERC20 _wantToken = vaultInfo[_vid].want;
        address vaultStrat = address(strat(_vid));
        if (address(_wantToken) != address(0)) {
            //withdraw fee is implemented here
            try vaultFeeManager.getWithdrawFee(_vid) returns (address feeReceiver, uint16 feeRate) {
                //hardcoded 3% max fee rate
                if (feeReceiver != address(0) && feeRate <= 300 && !paused(_vid)) { //waive withdrawal fee on paused vaults as there's generally something wrong
                    uint feeAmt = _wantAmt * feeRate / 10000;
                    _wantAmt -= feeAmt;
                    _wantToken.safeTransferFrom(vaultStrat, feeReceiver, feeAmt);
                }
            } catch {}

            _wantToken.safeTransferFrom(vaultStrat, _to, _wantAmt);
        }

        emit Withdraw(msg.sender, _to, _vid, _wantAmt);
    }

    //called by strategy, cannot be nonReentrant
    function executePendingDeposit(address _to, uint192 _amount) external {
        IERC20 token = pendingDeposits[msg.sender].token;
        uint amount0 = pendingDeposits[msg.sender].amount0;
        address from = pendingDeposits[msg.sender].from;
        uint amount1 = pendingDeposits[msg.sender].amount1;
        if (_amount > amount0 << 96 | amount1) revert UnauthorizedPendingDepositAmount();
        delete pendingDeposits[msg.sender];

        token.safeTransferFrom(from, _to, _amount);
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        if (from == address(0)) { //tokens minted during deposit
            for (uint i; i < ids.length; i++) {
                uint vid = ids[i];
                uint supplyBefore = totalSupply[vid];
                uint supplyAfter = supplyBefore + amounts[i];
                totalSupply[vid] = supplyAfter;

                if (vid > 2**16 && supplyBefore > 0) {
                    uint bal = balanceOf(to, vid);
                    _maximizerHarvest(to, vid, bal, bal + amounts[i], supplyBefore, supplyAfter);
                }
            }
        } else if (to == address(0)) { //tokens burned during withdrawal
            for (uint i; i < ids.length; i++) {
                uint vid = ids[i];
                uint amount = amounts[i];
                uint supplyAfter = totalSupply[vid] - amount;
                totalSupply[vid] = supplyAfter;

                if (vid > 2**16 && amount > 0) {
                    if (supplyAfter == 0) {
                        uint targetVid = vid >> 16;
                        address vaultStrat = address(strat(vid));
                        uint remainingTargetShares = balanceOf(vaultStrat, targetVid);

                        _safeTransferFrom(vaultStrat, from, targetVid, remainingTargetShares, "");

                        totalMaximizerEarnings[vid] = 0;
                        maximizerEarningsOffset[from][vid] = 0;
                        emit MaximizerHarvest(from, vid, remainingTargetShares);
                    } else {
                        uint bal = balanceOf(from, vid);
                        _maximizerHarvest(from, vid, bal, bal - amount, supplyAfter + amount, supplyAfter);
                    }
                }
            }
        } else {
            for (uint i; i < ids.length; i++) {
                uint vid = ids[i];
                if (vid > 2**16) {
                    _earn(vid, vaultFeeManager.getEarnFees(vid), msg.data[0:0]);
                    _maximizerHarvest(from, vid, balanceOf(from, vid), balanceOf(from, vid) - amounts[i], totalSupply[vid], totalSupply[vid]);
                    _maximizerHarvest(to, vid, balanceOf(to, vid), balanceOf(to, vid) + amounts[i], totalSupply[vid], totalSupply[vid]);
                }
            }
        }
    }

	//Add nonReentrant for maximizer security
	function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public virtual override(ERC1155, IERC1155) nonReentrant { super.safeTransferFrom(from, to, id, amount, data); }
	
	//Add nonReentrant for maximizer security
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public virtual override(ERC1155, IERC1155) nonReentrant { super.safeBatchTransferFrom(from, to, ids, amounts, data); }


    // // For maximizer vaults, this function helps us keep track of each users' claim on the tokens in the target vault
	function _maximizerHarvest(address _account, uint256 _vid, uint256 _balance, uint256 _supply) private {
        _maximizerHarvest(_account, _vid, _balance, _balance, _supply, _supply);
    }
	
	
    function _maximizerHarvest(address _account, uint256 _vid, uint256 _balanceBefore, uint256 _balanceAfter, uint256 _supplyBefore, uint256 _supplyAfter) private {
        uint accountOffset = maximizerEarningsOffset[_account][_vid];
        uint totalBefore = totalMaximizerEarnings[_vid];
		
		maximizerEarningsOffset[_account][_vid] = _balanceAfter * totalBefore / _supplyBefore;
        totalMaximizerEarnings[_vid] = _supplyAfter * totalBefore / _supplyBefore;

        uint targetShares = _balanceBefore * totalBefore / _supplyBefore;
        if (targetShares > accountOffset) {
            uint sharesEarned = targetShares - accountOffset;
            _safeTransferFrom(address(strat(_vid)), _account, _vid >> 16, sharesEarned, "");
            emit MaximizerHarvest(_account, _vid, sharesEarned);
        }
    }

	
	function maximizerPendingTargetShares(address _account, uint256 _vid) public view returns (uint256) {
        uint userVaultBalance = balanceOf(_account, _vid);
		if (userVaultBalance == 0) return 0;		

		uint targetVidShares = userVaultBalance * totalMaximizerEarnings[_vid] / totalSupply[_vid];
		uint accountOffset = maximizerEarningsOffset[_account][_vid];
		
		return targetVidShares > accountOffset ? targetVidShares - accountOffset : 0;
	}

	//balanceOf, but including all pending shares from maximizers
	function totalBalanceOf(address _account, uint256 _vid) external view returns (uint256 amount) {
		amount = super.balanceOf(_account, _vid);
		uint lastMaximizer = (_vid << 16) + vaultInfo[_vid].numMaximizers;
		for (uint i = (_vid << 16) + 1; i <= lastMaximizer; i++) {
			amount += maximizerPendingTargetShares(_account, i);
		}
	}
    function totalBalanceOfBatch(address[] calldata _account, uint256[] calldata _vid) external view returns (uint256[] memory amounts) {
        amounts = super.balanceOfBatch(_account, _vid);

        for (uint k; k < amounts.length; k++) {
            uint lastMaximizer = (_vid[k] << 16) + vaultInfo[_vid[k]].numMaximizers;
            for (uint i = (_vid[k] << 16) + 1; i <= lastMaximizer; i++) {
                amounts[k] += maximizerPendingTargetShares(_account[k], i);
            }
        }
    }

	function harvestMaximizer(uint256 _vid) external nonReentrant {
		_maximizerHarvest(msg.sender, _vid, balanceOf(msg.sender, _vid), totalSupply[_vid]);
	}
	
	function harvestTarget(uint256 _vid) external nonReentrant {
		uint lastMaximizer = (_vid << 16) + vaultInfo[_vid].numMaximizers;
		for (uint i = (_vid << 16) + 1; i <= lastMaximizer; i++) {
			_maximizerHarvest(msg.sender, i, balanceOf(msg.sender, i), totalSupply[i]);
		}		
	}
}
