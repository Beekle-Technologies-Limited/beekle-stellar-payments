import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMerchantDto {
  @ApiProperty({ example: 'Northwind Goods' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    example: 'GD6WU64XHG2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y4Q2Y',
    description: 'Merchant self-custody account. Public key only.',
  })
  @IsString()
  stellar_destination!: string;

  @ApiPropertyOptional({
    example: 'http://127.0.0.1:9099/hooks/beekle',
    description:
      'Registered callback. Allowlisted hosts only. Not taken from payment requests.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhook_url?: string;

  @ApiPropertyOptional({
    description:
      'HMAC secret you will use to verify webhooks. Required with webhook_url. It is encrypted at rest and is not returned.',
    minLength: 16,
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(200)
  webhook_secret?: string;
}

export class CreateIntentDto {
  @ApiProperty({
    example: '25.5000000',
    description: 'Fixed-point decimal string, max 7 places.',
  })
  @IsString()
  @Matches(/^(0|[1-9]\d*)(\.\d{1,7})?$/)
  amount!: string;

  @ApiProperty({ example: 'USDC' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,12}$/)
  asset_code!: string;

  @ApiPropertyOptional({
    example: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    description:
      'Required for issued assets. Omit only for native XLM when XLM is accepted.',
  })
  @IsOptional()
  @IsString()
  asset_issuer?: string;

  @ApiPropertyOptional({ example: 'order-1001' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  merchant_order_ref?: string;

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(604800)
  expires_in_seconds?: number;
}

export class DemoCheckoutDto {
  @ApiPropertyOptional({ example: '10.0000000' })
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional({
    description:
      'Existing funded testnet account. Omit to preview an unfunded watch-only address.',
  })
  @IsOptional()
  @IsString()
  stellar_destination?: string;
}

export class CursorDto {
  @ApiProperty()
  @IsString()
  account_id!: string;

  @ApiProperty({ example: '' })
  @IsString()
  cursor!: string;
}

export class BackfillDto {
  @ApiProperty()
  @IsString()
  account_id!: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  max_pages?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  from_cursor?: string;
}

export class ExternalRefundDto {
  @ApiProperty({ example: 'Merchant refunded from their own wallet' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;

  @ApiProperty({ example: 'off-platform-ref-42' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  external_reference!: string;
}
