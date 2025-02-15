// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.14;

import "./QuartzUniV2Zap.sol";
import "./VaultHealerBoostedPools.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

contract VaultHealer is VaultHealerBoostedPools, Multicall {

    address immutable public zap;

    constructor(address _vhAuth, address _feeMan, address _zap)
        VaultHealerBase(_vhAuth, _feeMan)
        ERC1155("")
    {
        zap = _zap;
    }

   function isApprovedForAll(address account, address operator) public view override(ERC1155, IERC1155) returns (bool) {
        return super.isApprovedForAll(account, operator) || operator == address(zap);
   }

    function setURI(string calldata _uri) external auth {
        _setURI(_uri);
    }

    function stakedWantTokens(address account, uint vid) public view returns (uint) {
        uint shares = account == address(0) ? 0 : balanceOf(account, vid);
        return shares == 0 ? 0 : wantLockedTotal(vid) * shares / totalSupply[vid];
    }
    
    function tokenData(address account, uint[] calldata vids) external view returns (uint[4][] memory data) {
        /*[0]: user staked want tokens
          [1]: user shares (balanceOf)
          [2]: wantLockedTotal
          [3]: totalSupply
        */

        uint len = vids.length;
        data = new uint[4][](len);

        for (uint i; i < vids.length; i++) {
            uint vid = vids[i];
            uint supply = totalSupply[vid];
            if (supply == 0) continue;
            data[i][3] = supply;
            uint wlt = wantLockedTotal(vid);
            data[i][2] = wlt;
            if (account == address(0)) continue;
            uint bal = balanceOf(account, vid);
            data[i][1] = bal;
            data[i][0] = bal * wlt / supply;
        }
    }
    function wantLockedTotal(uint vid) public view returns (uint) {
        return strat(vid).wantLockedTotal();
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155, IERC165) returns (bool) {
        return ERC1155.supportsInterface(interfaceId) || interfaceId == type(IVaultHealer).interfaceId;
    }

    //This contract should not hold ERC20 tokens at the end of a transaction. If this happens due to some error, this will send the 
    //tokens to the treasury if it is set. Contact the team for help, and maybe they can return your missing token!
    function rescue(address token) external {
        (address receiver,) = vaultFeeManager.getWithdrawFee(0);
        if (receiver == address(0)) receiver = msg.sender;
        IERC20(token).transfer(receiver, IERC20(token).balanceOf(address(this)));
    }
}