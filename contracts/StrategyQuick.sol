// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.14;

import "./Strategy.sol";
import "./interfaces/IDragonLair.sol";

contract StrategyQuick is Strategy {

    IDragonLair public constant D_QUICK = IDragonLair(0xf28164A485B0B2C90639E47b0f377b4a438a16B1);

    function _vaultHarvest() internal override {
        super._vaultHarvest();
        uint balance = D_QUICK.balanceOf(address(this));
        if (balance > 0) D_QUICK.leave(balance);
    }
}