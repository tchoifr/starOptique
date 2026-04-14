use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("4CQ2KzmEvWw4m6acrzNUNz33Tf1KWfzJ5GR2gzCGcxJ1");

#[program]
pub mod byhnex_vault_nft {
    use super::*;

    // =========================
    // LIST NFT (lock in vault)
    // =========================
    pub fn list_nft(ctx: Context<ListNft>) -> Result<()> {
        let listing = &mut ctx.accounts.listing;

        listing.seller = ctx.accounts.seller.key();
        listing.nft_mint = ctx.accounts.nft_mint.key();
        listing.bump = ctx.bumps.listing;

        // Transfer NFT to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_nft_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
        )?;

        Ok(())
    }

    // =========================
    // BUY NFT
    // =========================
    pub fn buy_nft(ctx: Context<BuyNft>) -> Result<()> {
        let listing = &ctx.accounts.listing;

        let seeds = &[
            b"listing",
            listing.seller.as_ref(),
            listing.nft_mint.as_ref(),
            &[listing.bump],
        ];

        // Transfer NFT to buyer
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.buyer_nft_ata.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )?;

        // Close vault
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.vault.to_account_info(),
                    destination: ctx.accounts.seller.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[seeds],
            ),
        )?;

        Ok(())
    }

    // =========================
    // CANCEL LISTING
    // =========================
    pub fn cancel_nft(ctx: Context<CancelNft>) -> Result<()> {
        let listing = &ctx.accounts.listing;

        let seeds = &[
            b"listing",
            listing.seller.as_ref(),
            listing.nft_mint.as_ref(),
            &[listing.bump],
        ];

        // Return NFT to seller
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.seller_nft_ata.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[seeds],
            ),
            1,
        )?;

        // Close vault
        token::close_account(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.vault.to_account_info(),
                    destination: ctx.accounts.seller.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[seeds],
            ),
        )?;

        Ok(())
    }
}

//
// =========================
// ACCOUNTS
// =========================
//

#[derive(Accounts)]
pub struct ListNft<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::SPACE,
        seeds = [
            b"listing",
            seller.key().as_ref(),
            nft_mint.key().as_ref()
        ],
        bump
    )]
    pub listing: Box<Account<'info, Listing>>,

    #[account(
        init,
        payer = seller,
        token::mint = nft_mint,
        token::authority = listing,
        seeds = [b"vault", listing.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub seller_nft_ata: Box<Account<'info, TokenAccount>>,

    pub nft_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BuyNft<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(mut)]
    pub seller: SystemAccount<'info>,

    #[account(
        mut,
        close = seller,
        seeds = [
            b"listing",
            listing.seller.as_ref(),
            listing.nft_mint.as_ref()
        ],
        bump = listing.bump
    )]
    pub listing: Box<Account<'info, Listing>>,

    #[account(
        mut,
        seeds = [b"vault", listing.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub buyer_nft_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelNft<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        mut,
        close = seller,
        seeds = [
            b"listing",
            seller.key().as_ref(),
            listing.nft_mint.as_ref()
        ],
        bump = listing.bump
    )]
    pub listing: Box<Account<'info, Listing>>,

    #[account(
        mut,
        seeds = [b"vault", listing.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub seller_nft_ata: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

//
// =========================
// DATA
// =========================
//

#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub nft_mint: Pubkey,
    pub bump: u8,
}

impl Listing {
    pub const SPACE: usize = 32 + 32 + 1;
}
