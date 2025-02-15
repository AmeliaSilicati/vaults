// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IUniRouter.sol";
import "../libraries/Fee.sol";
import "../libraries/Tactics.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "./IMagnetite.sol";
import "./IVaultHealer.sol";

interface IStrategy is IERC165 {

    error Muppet(address caller); //1bfef483
    error IdenticalAddresses(IERC20 a, IERC20 b);
    error ZeroAddress();
    error InsufficientOutputAmount(uint amountOut, uint amountOutMin);
    error Strategy_CriticalMemoryError(uint ptr); //decbcfd4
    error Strategy_Improper1155Deposit(address operator, address from, uint id);
    error Strategy_Improper1155BatchDeposit(address operator, address from, uint[] ids);
    error Strategy_ImproperEthDeposit(address sender, uint amount);
    error Strategy_NotVaultHealer(address sender); //3da8f0c0
    error Strategy_InitializeOnlyByProxy(); //2ebab949
    error Strategy_ExcessiveFarmSlippage();
    error Strategy_WantLockedLoss(); //73e0bc96
	error Strategy_TotalSlippageWithdrawal(); //099d5d11 //nothing to withdraw after slippage
	error Strategy_DustDeposit(uint256 wantAdded); //eaf3800a - Deposit amount is insignificant after slippage
    error Strategy_AlreadyInitialized(); //f3222d46
    error Strategy_MaximizersNotSupported();

    event Strategy_MaximizerDepositFailure();

    function initialize (bytes calldata data) external;
    function wantToken() external view returns (IERC20); // Want address
    function wantLockedTotal() external view returns (uint256); // Total want tokens managed by strategy (vaultSharesTotal + want token balance)
	function vaultSharesTotal() external view returns (uint256); //Want tokens deposited in strategy's pool
    function earn(Fee.Data[3] memory fees, address _operator, bytes calldata _data) external returns (bool success, uint256 _wantLockedTotal); // Main want token compounding function
    
    function deposit(uint256 _wantAmt, uint256 _sharesTotal, bytes calldata _data) external payable returns (uint256 wantAdded, uint256 sharesAdded);
    function withdraw(uint256 _wantAmt, uint256 _userShares, uint256 _sharesTotal, bytes calldata _data) external returns (uint256 sharesRemoved, uint256 wantAmt);

    function panic() external;
    function unpanic() external;
    function router() external view returns (IUniRouter); // Univ2 router used by this strategy

    function vaultHealer() external view returns (IVaultHealer);
    function implementation() external view returns (IStrategy);
    function isMaximizer() external view returns (bool);
    function getMaximizerImplementation() external view returns (IStrategy);

    struct ConfigInfo {
        uint256 vid;
        IERC20 want;
        uint256 wantDust;
        address masterchef;
        uint pid;
        IUniRouter _router;
        IMagnetite _magnetite;
        IERC20[] earned;
        uint256[] earnedDust;
        uint slippageFactor;
        bool feeOnTransfer;
    }

    function configInfo() external view returns (ConfigInfo memory);
    function tactics() external view returns (Tactics.TacticsA tacticsA, Tactics.TacticsB tacticsB);
    
}