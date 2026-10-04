import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { RegisterDto } from './register.dto';
import { BUYER_CATEGORIES } from '../../briefs/taxonomy';
export class RegisterBuyerDto extends RegisterDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalName: string;

  @ApiProperty({ enum: BUYER_CATEGORIES.map((category) => category.id) })
  @IsIn(BUYER_CATEGORIES.map((category) => category.id))
  categoryId: string;
}
