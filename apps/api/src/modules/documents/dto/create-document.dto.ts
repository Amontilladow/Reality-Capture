import { IsString, IsOptional, IsDateString, IsUUID, IsUrl, IsIn } from 'class-validator';

export class CreateDocumentDto {
  @IsIn(['drawing','specification','rfi','submittal','transmittal','inspection_record',
    'method_statement','risk_assessment','handover_certificate','test_report','ncrm','other'])
  docType: string;

  @IsString() title: string;
  @IsOptional() @IsString()  documentNumber?: string;
  @IsOptional() @IsString()  revision?: string;
  @IsOptional() @IsString()  status?: string;
  @IsOptional() @IsString()  discipline?: string;
  @IsOptional() @IsIn(['internal','procore','aconex','sharepoint','bim360','manual_link']) source?: string;
  @IsOptional() @IsString()  externalId?: string;
  @IsOptional() @IsString()  externalUrl?: string;
  @IsOptional() @IsString()  storageKey?: string;
  @IsOptional() @IsDateString() documentDate?: string;
  @IsOptional() @IsDateString() receivedDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}